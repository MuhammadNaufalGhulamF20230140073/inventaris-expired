// prismaClient.js - Singleton Prisma Client untuk Vercel Serverless
// Mencegah "too many connections" di serverless environment

const { PrismaClient } = require('@prisma/client');

let prisma;

if (process.env.NODE_ENV === 'production') {
    prisma = new PrismaClient();
} else {
    // Di development: reuse instance agar tidak banyak koneksi saat hot-reload
    if (!global.__prisma) {
        global.__prisma = new PrismaClient();
    }
    prisma = global.__prisma;
}

module.exports = prisma;
