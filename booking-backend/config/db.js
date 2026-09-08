// config/db.js
const dns = require("node:dns");
const mongoose = require("mongoose");

// Force public DNS resolvers for the mongodb+srv SRV lookup. Local ISP and
// router DNS frequently refuse SRV queries on Windows (querySrv ECONNREFUSED),
// which is a confusing failure that looks like bad credentials. Same fix the
// existing Chefo backend carries.
dns.setServers(["8.8.8.8", "1.1.1.1"]);

async function connectDB() {
    await mongoose.connect(process.env.MONGODB_URI);
    const { name } = mongoose.connection;
    console.log(`MongoDB connected (database: ${name})`);
}

module.exports = { connectDB };
