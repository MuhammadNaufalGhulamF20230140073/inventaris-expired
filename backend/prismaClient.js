// prismaClient.js - Lazy Singleton Prisma Client untuk Vercel Serverless
// Mencegah crash modul saat evaluasi awal di Lambda & menghemat koneksi

let PrismaClient;
let instance;

function getPrismaInstance() {
    if (!instance) {
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
        if (process.env.NODE_ENV === 'production') {
            instance = new PrismaClient({
                log: ['error', 'warn'],
            });
        } else {
            if (!global.__prismaInstance) {
                global.__prismaInstance = new PrismaClient();
            }
            instance = global.__prismaInstance;
        }
    }
    return instance;
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
