// prismaClient.js - Lazy Singleton Prisma Client untuk Vercel Serverless
// Mencegah crash modul saat evaluasi awal di Lambda & menghemat koneksi

const { PrismaClient } = require('@prisma/client');

let instance;

function getPrismaInstance() {
    if (!instance) {
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
