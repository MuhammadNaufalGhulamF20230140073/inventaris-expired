// prismaClient.js - Lazy Singleton Prisma Client untuk Vercel Serverless
// Mencegah crash modul saat evaluasi awal di Lambda & menghemat koneksi

let PrismaClient;
let instance;

const DEFAULT_DB_URL = "postgres://20fd37405ccc2b62c90b0a0ceced9d2278d43e13c0f46fff79118256fb256531:sk_0LFZA-Vk6bXmKSBoitheF@db.prisma.io:5432/postgres?sslmode=require";

function getPrismaInstance() {
    if (global.__prismaInstance) {
        return global.__prismaInstance;
    }

    if (!PrismaClient) {
        try {
            PrismaClient = require('@prisma/client').PrismaClient;
        } catch (e1) {
            try {
                PrismaClient = require('../node_modules/@prisma/client').PrismaClient;
            } catch (e2) {
                PrismaClient = require('../../node_modules/@prisma/client').PrismaClient;
            }
        }
    }

    let dbUrl = process.env.DATABASE_URL || DEFAULT_DB_URL;

    // Untuk serverless (Vercel), batasi connection_limit=1 & pool_timeout=10 jika belum diset
    if (dbUrl && !dbUrl.includes("connection_limit")) {
        const sep = dbUrl.includes("?") ? "&" : "?";
        dbUrl = `${dbUrl}${sep}connection_limit=1&pool_timeout=10`;
    }

    global.__prismaInstance = new PrismaClient({
        datasources: { db: { url: dbUrl } },
        log: ['error', 'warn'],
    });

    return global.__prismaInstance;
}

// Proxy agar panggil prisma.users, prisma.barang dsb tetap sama tanpa mengubah controller
const prismaProxy = new Proxy({}, {
    get(target, prop) {
        const client = getPrismaInstance();
        const value = client[prop];
        if (typeof value === 'function') {
            return value.bind(client);
        }
        return value;
    }
});

module.exports = prismaProxy;
