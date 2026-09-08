// models/Role.js — a named set of permissions, owned by one business.
//
// Roles are DATA, not code. "Kitchen Lead" is a row holding
// ["dashboard.view", "requests.resolve", ...], which is what lets an operator
// invent a role next month without anyone shipping a release, and why nothing
// in this product ever tests a role's name.
const mongoose = require("mongoose");

const roleSchema = new mongoose.Schema(
    {
        businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
        name: { type: String, required: true, trim: true },
        description: { type: String, default: "" },
        // Validated against utils/permissions.js on every write, so a crafted
        // request cannot store a permission the application does not define.
        permissions: { type: [String], default: [] },
        // Soft delete. A role someone is still assigned to must not vanish from
        // under them mid-shift; archiving keeps the reference resolvable while
        // removing it from the pickers.
        archivedAt: { type: Date, default: null },
        createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessUser" },
    },
    { timestamps: true }
);

// Partial, so an archived name can be reused later.
roleSchema.index(
    { businessId: 1, name: 1 },
    { unique: true, partialFilterExpression: { archivedAt: null } }
);

module.exports = mongoose.model("Role", roleSchema);
