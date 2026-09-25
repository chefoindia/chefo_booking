// routes/team.js — who can sign into the dashboard, and what they may do.
//
// THE ESCALATION RULES, enforced here and not merely in the UI:
//   * businessId is ALWAYS req.businessId. Never read from the body, so no
//     request can create a user in another business or move one between them.
//   * A target must already belong to THIS business. Owners are excluded from
//     these queries entirely, so team administration can never touch an owner
//     and nothing here can promote anyone to owner.
//   * Assigning a role grants every permission in it, so a non-owner may only
//     assign roles built from permissions they could grant themselves. That is
//     what stops someone with users.edit handing themselves the manager role.
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const router = express.Router();

const BusinessUser = require("../models/BusinessUser");
const Role = require("../models/Role");
const Outlet = require("../models/Outlet");
const { inScope } = require("../utils/outletScope");
const { authenticate, requirePermission, actorOf } = require("../middleware/authenticate");
const { MODULES, canGrant, filterGrantable } = require("../utils/permissions");
const { normalisePhone } = require("../utils/phone");
const { record } = require("../services/audit");
const { notify, CONCERN } = require("../services/notify");

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v));
const permList = (list) => (list?.length ? list.join(", ") : "none");
const clean = (v, max = 80) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const meta = (req) => ({ ip: req.ip, userAgent: req.headers["user-agent"] || "" });

// Never includes passwordHash or tokenVersion. Shaped explicitly on the way out
// so a future schema field cannot leak by being returned wholesale.
const shapeUser = (u, role, outletNames = new Map()) => ({
    id: u._id,
    name: u.name,
    email: u.email || "",
    phone: u.phone || "",
    loginId: u.loginId || "",
    isOwner: Boolean(u.isOwner),
    isActive: u.isActive !== false,
    roleId: u.roleId || null,
    roleName: role?.name || "",
    roleArchived: Boolean(role?.archivedAt),
    // Empty = canteen-wide. Owners are always canteen-wide whatever is stored.
    outletIds: u.isOwner ? [] : (u.outletIds || []).map(String),
    outletNames: u.isOwner ? [] : (u.outletIds || []).map((id) => outletNames.get(String(id)) || "").filter(Boolean),
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
});

/**
 * Which outlets may this actor assign to someone?
 *
 * Same escalation rule as roles: you cannot hand out what you do not hold.
 * A canteen-wide actor may assign any outlet of the business, or none
 * (canteen-wide). An actor restricted to Block A may only assign Block A —
 * and may NOT assign "no restriction", because that is wider than their own.
 *
 * Ids from another business are simply not found and refused.
 */
async function resolveAssignableOutlets(req, outletIds) {
    if (outletIds === undefined) return { ok: true, outletIds: undefined };   // not touched
    const wanted = Array.isArray(outletIds) ? [...new Set(outletIds.map(String).filter(isId))] : [];
    if (Array.isArray(outletIds) && wanted.length !== new Set(outletIds.map(String)).size) {
        return { ok: false, status: 400, message: "Invalid outlet." };
    }
    if (!wanted.length) {
        if (req.outletScope) {
            return { ok: false, status: 403, code: "OUTLET_NOT_GRANTABLE",
                message: "You are limited to certain outlets, so you can't give someone access to every outlet." };
        }
        return { ok: true, outletIds: [] };
    }
    const found = await Outlet.find({ _id: { $in: wanted }, businessId: req.businessId }).select("_id name").lean();
    if (found.length !== wanted.length) return { ok: false, status: 404, message: "Outlet not found." };
    const beyond = found.filter((o) => !inScope(req.outletScope, o._id));
    if (beyond.length) {
        return { ok: false, status: 403, code: "OUTLET_NOT_GRANTABLE",
            message: `You can't give access to ${beyond.map((o) => o.name).join(", ")} — you don't have it yourself.` };
    }
    return { ok: true, outletIds: found.map((o) => o._id), names: found.map((o) => o.name) };
}

const notGrantable = (res, refused, verb = "grant") =>
    res.status(403).json({
        message: `You cannot ${verb} permissions you do not hold yourself.`,
        code: "PERMISSION_NOT_GRANTABLE",
        refused,
    });

/* ------------------------------------------------------------------ */
/* PERMISSION CATALOGUE                                                 */
/* ------------------------------------------------------------------ */
// The role editor renders from this rather than a hardcoded copy, so adding a
// permission to utils/permissions.js appears in the UI with no frontend change.
// `grantable` tells the UI to lock what this actor could not hand out anyway.
router.get("/api/roles/catalogue",
    authenticate, requirePermission("roles.view"),
    (req, res) => {
        const actor = actorOf(req);
        res.json({
            modules: MODULES.map((m) => ({
                key: m.key, label: m.label, hint: m.hint || "",
                ownerOnly: Boolean(m.owner), sensitive: Boolean(m.sensitive),
                actions: m.actions.map((a) => ({
                    action: a,
                    permission: `${m.key}.${a}`,
                    grantable: canGrant(actor, `${m.key}.${a}`),
                })),
            })),
        });
    });

/* ------------------------------------------------------------------ */
/* ROLES                                                                */
/* ------------------------------------------------------------------ */
router.get("/api/roles",
    authenticate, requirePermission("roles.view"),
    async (req, res, next) => {
        try {
            const roles = await Role.find({ businessId: req.businessId }).sort({ name: 1 }).lean();
            const counts = await BusinessUser.aggregate([
                {
                    $match: {
                        businessId: new mongoose.Types.ObjectId(String(req.businessId)),
                        roleId: { $ne: null },
                    },
                },
                { $group: { _id: "$roleId", n: { $sum: 1 } } },
            ]);
            const byRole = new Map(counts.map((c) => [String(c._id), c.n]));
            res.json({
                roles: roles.map((r) => ({
                    ...r, id: r._id, staffCount: byRole.get(String(r._id)) || 0,
                    archived: Boolean(r.archivedAt),
                })),
            });
        } catch (err) { next(err); }
    });

router.post("/api/roles",
    authenticate, requirePermission("roles.create"),
    async (req, res, next) => {
        try {
            const name = clean(req.body?.name, 40);
            if (!name) return res.status(400).json({ message: "Give the role a name." });

            const { allowed, refused } = filterGrantable(actorOf(req), req.body?.permissions);
            // Refused loudly rather than silently saving a subset: an owner who
            // ticks ten boxes and quietly gets seven has a role that does not do
            // what the screen said, and no way to find out.
            if (refused.length) return notGrantable(res, refused);

            if (await Role.exists({ businessId: req.businessId, name, archivedAt: null })) {
                return res.status(409).json({ message: `A role called "${name}" already exists.` });
            }

            const role = await Role.create({
                businessId: req.businessId,
                name,
                description: clean(req.body?.description, 160),
                permissions: allowed,
                createdByUserId: req.actor.userId,
            });

            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: "Created a role", after: { name, permissions: allowed },
            });
            notify("roles.changed", {
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                title: "Role created", summary: `A new role, "${name}", was created in your team settings.`,
                rows: [{ label: "Role", value: name }, { label: "Permissions", value: permList(allowed) }],
                concern: CONCERN.access,
            });
            res.status(201).json({ role });
        } catch (err) { next(err); }
    });

router.patch("/api/roles/:id",
    authenticate, requirePermission("roles.edit"),
    async (req, res, next) => {
        try {
            if (!isId(req.params.id)) return res.status(400).json({ message: "Invalid role." });
            const role = await Role.findOne({ _id: req.params.id, businessId: req.businessId });
            if (!role) return res.status(404).json({ message: "Role not found." });

            const before = { name: role.name, permissions: [...(role.permissions || [])] };

            if (req.body?.name !== undefined) {
                const name = clean(req.body.name, 40);
                if (!name) return res.status(400).json({ message: "Give the role a name." });
                if (name !== role.name
                    && await Role.exists({ businessId: req.businessId, name, archivedAt: null })) {
                    return res.status(409).json({ message: `A role called "${name}" already exists.` });
                }
                role.name = name;
            }
            if (req.body?.description !== undefined) role.description = clean(req.body.description, 160);

            if (req.body?.permissions !== undefined) {
                const { allowed, refused } = filterGrantable(actorOf(req), req.body.permissions);
                if (refused.length) return notGrantable(res, refused);

                // Removing is privileged too: a delegate must not be able to
                // strip a permission they could never have granted, or they
                // could quietly disarm someone above them.
                const removed = before.permissions.filter((p) => !allowed.includes(p));
                const unremovable = removed.filter((p) => !canGrant(actorOf(req), p));
                if (unremovable.length) return notGrantable(res, unremovable, "remove");

                role.permissions = allowed;
            }

            await role.save();
            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: "Updated a role",
                before, after: { name: role.name, permissions: role.permissions },
            });
            const added = role.permissions.filter((p) => !before.permissions.includes(p));
            const removed = before.permissions.filter((p) => !role.permissions.includes(p));
            notify("roles.changed", {
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                title: "Role updated",
                summary: `The role "${role.name}" was changed. Everyone assigned to it is affected immediately.`,
                rows: [
                    { label: "Role", value: role.name + (before.name !== role.name ? ` (was "${before.name}")` : "") },
                    { label: "Permissions added", value: permList(added) },
                    { label: "Permissions removed", value: permList(removed) },
                ],
                concern: CONCERN.access,
            });
            res.json({ role: role.toObject() });
        } catch (err) { next(err); }
    });

// Soft delete. A role someone is assigned to must not vanish from under them —
// archiving keeps it resolvable while removing it from the pickers. Refused
// while anyone still holds it unless the caller explicitly detaches them, so
// nobody loses access silently.
router.post("/api/roles/:id/archive",
    authenticate, requirePermission("roles.delete"),
    async (req, res, next) => {
        try {
            if (!isId(req.params.id)) return res.status(400).json({ message: "Invalid role." });
            const role = await Role.findOne({ _id: req.params.id, businessId: req.businessId });
            if (!role) return res.status(404).json({ message: "Role not found." });
            if (role.archivedAt) return res.json({ role: role.toObject() });

            const beyond = (role.permissions || []).filter((p) => !canGrant(actorOf(req), p));
            if (beyond.length) return notGrantable(res, beyond, "archive a role holding");

            const assigned = await BusinessUser.countDocuments({
                businessId: req.businessId, roleId: role._id,
            });
            if (assigned > 0 && req.body?.reassign !== true) {
                return res.status(409).json({
                    message: `${assigned} ${assigned === 1 ? "person is" : "people are"} still assigned to this role.`,
                    code: "ROLE_IN_USE",
                    assigned,
                });
            }
            if (assigned > 0) {
                // Detached, not deleted. They keep their account and their
                // login; they simply have no permissions until given a new role.
                await BusinessUser.updateMany(
                    { businessId: req.businessId, roleId: role._id },
                    { $set: { roleId: null } }
                );
            }

            role.archivedAt = new Date();
            await role.save();

            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: "Archived a role", details: { name: role.name, unassigned: assigned },
            });
            notify("roles.changed", {
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                title: "Role archived", summary: `The role "${role.name}" was archived and no longer grants anything.`,
                rows: [{ label: "Role", value: role.name }, { label: "People detached", value: String(assigned) }],
                concern: CONCERN.access,
            });
            res.json({ role: role.toObject(), unassigned: assigned });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* TEAM MEMBERS                                                         */
/* ------------------------------------------------------------------ */
async function resolveAssignableRole(req, roleId) {
    if (roleId === null || roleId === undefined || roleId === "") return { ok: true, role: null };
    if (!isId(roleId)) return { ok: false, status: 400, message: "Invalid role." };

    // Scoped, so a role id from another business is simply not found.
    const role = await Role.findOne({ _id: roleId, businessId: req.businessId }).lean();
    if (!role) return { ok: false, status: 404, message: "Role not found." };
    if (role.archivedAt) return { ok: false, status: 400, message: "That role is archived. Pick an active one." };

    const beyond = (role.permissions || []).filter((p) => !canGrant(actorOf(req), p));
    if (beyond.length) {
        return {
            ok: false, status: 403, code: "PERMISSION_NOT_GRANTABLE", refused: beyond,
            message: "That role includes permissions you do not hold, so you cannot assign it.",
        };
    }
    return { ok: true, role };
}

router.get("/api/team",
    authenticate, requirePermission("users.view"),
    async (req, res, next) => {
        try {
            const users = await BusinessUser.find({ businessId: req.businessId })
                .sort({ isOwner: -1, name: 1 }).lean();
            const roleIds = [...new Set(users.map((u) => u.roleId).filter(Boolean).map(String))];
            const [roles, outlets] = await Promise.all([
                roleIds.length ? Role.find({ _id: { $in: roleIds }, businessId: req.businessId }).lean() : [],
                Outlet.find({ businessId: req.businessId }).select("name").lean(),
            ]);
            const byId = new Map(roles.map((r) => [String(r._id), r]));
            const outletNames = new Map(outlets.map((o) => [String(o._id), o.name]));
            res.json({ team: users.map((u) => shapeUser(u, byId.get(String(u.roleId)), outletNames)) });
        } catch (err) { next(err); }
    });

router.post("/api/team",
    authenticate, requirePermission("users.create"),
    async (req, res, next) => {
        try {
            const name = clean(req.body?.name, 60);
            if (!name) return res.status(400).json({ message: "Enter a name." });

            const email = clean(req.body?.email, 120).toLowerCase();
            const phone = req.body?.phone ? normalisePhone(req.body.phone) : "";
            const loginId = clean(req.body?.loginId, 32).toLowerCase();
            if (!email && !phone && !loginId) {
                return res.status(400).json({ message: "Enter a mobile number, login ID or email to sign in with." });
            }
            if (req.body?.phone && !phone) {
                return res.status(400).json({ message: "Enter a valid mobile number." });
            }
            if (loginId && !BusinessUser.isValidLoginId(loginId)) {
                return res.status(400).json({ message: "A login ID is 3–32 characters: letters, numbers, dots, underscores or hyphens." });
            }

            const password = String(req.body?.password || "");
            if (password.length < 8) {
                return res.status(400).json({ message: "Set a password of at least 8 characters." });
            }

            // Sign-in identifiers are global, so this checks across businesses —
            // otherwise the login lookup would be ambiguous.
            const clash = await BusinessUser.findOne({
                $or: [
                    ...(email ? [{ email }] : []),
                    ...(phone ? [{ phone }] : []),
                    ...(loginId ? [{ loginId }] : []),
                ],
            }).select("_id").lean();
            if (clash) {
                return res.status(409).json({ message: "That mobile number, login ID or email is already in use." });
            }

            const resolved = await resolveAssignableRole(req, req.body?.roleId ?? null);
            if (!resolved.ok) {
                return res.status(resolved.status)
                    .json({ message: resolved.message, code: resolved.code, refused: resolved.refused });
            }
            // Outlet restriction. Absent = canteen-wide for a canteen-wide
            // actor; a restricted actor must name outlets inside their own.
            const outletsRes = await resolveAssignableOutlets(req, req.body?.outletIds ?? (req.outletScope ? undefined : []));
            if (!outletsRes.ok) return res.status(outletsRes.status).json({ message: outletsRes.message, code: outletsRes.code });
            if (req.outletScope && outletsRes.outletIds === undefined) {
                return res.status(400).json({ message: "Choose which of your outlets this person may work at." });
            }

            const user = await BusinessUser.create({
                // From the session, never the body — no request can create a
                // user in another business.
                businessId: req.businessId,
                name, email, phone, loginId,
                passwordHash: await bcrypt.hash(password, 10),
                // Never settable from a request. Owners are made by seeding a
                // business, not by an API call.
                isOwner: false,
                roleId: resolved.role?._id || null,
                outletIds: outletsRes.outletIds || [],
                isActive: req.body?.isActive === false ? false : true,
            });

            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: "Added a team member",
                after: { name, role: resolved.role?.name || "None", outlets: outletsRes.names?.length ? outletsRes.names : "All outlets" },
            });
            notify("team.added", {
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                title: "Team member added", summary: `${name} can now sign into your dashboard.`,
                rows: [
                    { label: "Name", value: name },
                    { label: "Signs in with", value: [phone, loginId, email].filter(Boolean).join(" / ") },
                    { label: "Role", value: resolved.role?.name || "None yet" },
                    { label: "Outlets", value: outletsRes.names?.length ? outletsRes.names.join(", ") : "All outlets" },
                ],
                concern: CONCERN.access,
            });
            const names = new Map((outletsRes.outletIds || []).map((id, i) => [String(id), outletsRes.names[i]]));
            res.status(201).json({ member: shapeUser(user, resolved.role, names) });
        } catch (err) { next(err); }
    });

router.patch("/api/team/:id",
    authenticate, requirePermission("users.edit"),
    async (req, res, next) => {
        try {
            if (!isId(req.params.id)) return res.status(400).json({ message: "Invalid team member." });

            // isOwner:false is the guard that makes owners unreachable from
            // team administration — no separate branch is needed because the
            // query makes the case impossible.
            const user = await BusinessUser.findOne({
                _id: req.params.id, businessId: req.businessId, isOwner: false,
            });
            if (!user) return res.status(404).json({ message: "Team member not found." });

            const before = { name: user.name, roleId: user.roleId, isActive: user.isActive, outletIds: (user.outletIds || []).map(String) };

            // A restricted actor may only edit people inside their own outlets,
            // for the same reason they may only assign those outlets.
            if (req.outletScope) {
                const theirs = (user.outletIds || []);
                if (!theirs.length || !theirs.every((id) => inScope(req.outletScope, id))) {
                    return res.status(403).json({ message: "That person works at outlets you don't have access to.", code: "OUTLET_FORBIDDEN" });
                }
            }

            if (req.body?.name !== undefined) user.name = clean(req.body.name, 60) || user.name;

            if (req.body?.email !== undefined) {
                const email = clean(req.body.email, 120).toLowerCase();
                if (email !== user.email) {
                    if (email && await BusinessUser.exists({ email, _id: { $ne: user._id } })) {
                        return res.status(409).json({ message: "That email is already in use." });
                    }
                    user.email = email;
                }
            }
            if (req.body?.phone !== undefined) {
                const phone = req.body.phone ? normalisePhone(req.body.phone) : "";
                if (req.body.phone && !phone) {
                    return res.status(400).json({ message: "Enter a valid mobile number." });
                }
                if (phone !== user.phone) {
                    if (phone && await BusinessUser.exists({ phone, _id: { $ne: user._id } })) {
                        return res.status(409).json({ message: "That mobile number is already in use." });
                    }
                    user.phone = phone;
                }
            }
            if (req.body?.loginId !== undefined) {
                const loginId = clean(req.body.loginId, 32).toLowerCase();
                if (loginId && !BusinessUser.isValidLoginId(loginId)) {
                    return res.status(400).json({ message: "A login ID is 3–32 characters: letters, numbers, dots, underscores or hyphens." });
                }
                if (loginId !== user.loginId) {
                    if (loginId && await BusinessUser.exists({ loginId, _id: { $ne: user._id } })) {
                        return res.status(409).json({ message: "That login ID is already taken." });
                    }
                    user.loginId = loginId;
                }
            }
            if (!user.email && !user.phone && !user.loginId) {
                return res.status(400).json({ message: "Keep at least one sign-in identifier." });
            }

            if (req.body?.roleId !== undefined) {
                // Taking a role away is privileged too — a delegate must not be
                // able to strip permissions they could not have granted.
                if (user.roleId) {
                    const current = await Role.findById(user.roleId).lean();
                    const beyond = (current?.permissions || []).filter((p) => !canGrant(actorOf(req), p));
                    if (beyond.length) return notGrantable(res, beyond, "change a role holding");
                }
                const resolved = await resolveAssignableRole(req, req.body.roleId);
                if (!resolved.ok) {
                    return res.status(resolved.status)
                        .json({ message: resolved.message, code: resolved.code, refused: resolved.refused });
                }
                user.roleId = resolved.role?._id || null;
            }

            let outletsChanged = false;
            if (req.body?.outletIds !== undefined) {
                const outletsRes = await resolveAssignableOutlets(req, req.body.outletIds);
                if (!outletsRes.ok) return res.status(outletsRes.status).json({ message: outletsRes.message, code: outletsRes.code });
                const next_ = (outletsRes.outletIds || []).map(String).sort().join(",");
                outletsChanged = next_ !== [...before.outletIds].sort().join(",");
                user.outletIds = outletsRes.outletIds || [];
                // Narrowing someone's outlets must bite on their next request,
                // not at token expiry — same as a deactivation.
                if (outletsChanged) user.tokenVersion += 1;
            }

            let passwordChanged = false;
            if (req.body?.password !== undefined) {
                const password = String(req.body.password);
                if (password.length < 8) {
                    return res.status(400).json({ message: "Password must be at least 8 characters." });
                }
                user.passwordHash = await bcrypt.hash(password, 10);
                user.passwordSet = true;
                user.tokenVersion += 1; // ends their existing sessions
                passwordChanged = true;
            }

            if (req.body?.isActive !== undefined) {
                if (String(user._id) === String(req.actor.userId)) {
                    return res.status(400).json({ message: "You can't change your own status." });
                }
                user.isActive = Boolean(req.body.isActive);
                // Takes effect on their very next request, not at token expiry.
                user.tokenVersion += 1;
            }

            await user.save();
            const [role, outletDocs] = await Promise.all([
                user.roleId ? Role.findById(user.roleId).lean() : null,
                user.outletIds?.length ? Outlet.find({ _id: { $in: user.outletIds } }).select("name").lean() : [],
            ]);
            const outletNames = new Map(outletDocs.map((o) => [String(o._id), o.name]));

            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: "Updated a team member",
                before, after: {
                    name: user.name, roleId: user.roleId, isActive: user.isActive, passwordChanged,
                    outletIds: (user.outletIds || []).map(String),
                },
            });

            const roleChanged = String(before.roleId || "") !== String(user.roleId || "");
            const deactivated = before.isActive !== false && user.isActive === false;
            const reactivated = before.isActive === false && user.isActive !== false;
            if (deactivated) {
                notify("team.removed", {
                    businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                    title: "Team member deactivated", summary: `${user.name} can no longer sign in. Their existing sessions were ended.`,
                    rows: [{ label: "Name", value: user.name }], concern: CONCERN.access,
                });
            } else if (roleChanged || passwordChanged || reactivated || outletsChanged) {
                notify("team.changed", {
                    businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                    title: "Team member updated",
                    summary: `${user.name}'s account was changed.`,
                    rows: [
                        { label: "Name", value: user.name },
                        ...(roleChanged ? [{ label: "Role", value: role?.name || "None" }] : []),
                        ...(outletsChanged ? [{ label: "Outlets", value: outletDocs.length ? outletDocs.map((o) => o.name).join(", ") : "All outlets" }] : []),
                        ...(passwordChanged ? [{ label: "Password", value: "Set to a new value" }] : []),
                        ...(reactivated ? [{ label: "Status", value: "Reactivated" }] : []),
                    ],
                    concern: CONCERN.access,
                });
            }
            res.json({ member: shapeUser(user, role, outletNames) });
        } catch (err) { next(err); }
    });

// Deactivate and detach rather than delete — audit rows reference this user,
// and hard-deleting would orphan the record of everything they approved.
router.delete("/api/team/:id",
    authenticate, requirePermission("users.delete"),
    async (req, res, next) => {
        try {
            if (!isId(req.params.id)) return res.status(400).json({ message: "Invalid team member." });
            if (String(req.params.id) === String(req.actor.userId)) {
                return res.status(400).json({ message: "You can't remove your own account." });
            }

            const user = await BusinessUser.findOne({
                _id: req.params.id, businessId: req.businessId, isOwner: false,
            });
            if (!user) return res.status(404).json({ message: "Team member not found." });

            user.isActive = false;
            user.roleId = null;
            user.outletIds = [];
            user.email = "";
            user.phone = "";
            user.loginId = "";  // frees the identifiers for reuse
            user.tokenVersion += 1;
            await user.save();

            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: "Removed a team member", details: { name: user.name },
            });
            notify("team.removed", {
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                title: "Team member removed", summary: `${user.name} was removed from the team and signed out everywhere.`,
                rows: [{ label: "Name", value: user.name }], concern: CONCERN.access,
            });
            res.json({ removed: true });
        } catch (err) { next(err); }
    });

module.exports = router;
