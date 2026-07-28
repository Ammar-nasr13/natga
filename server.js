const express = require('express');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const compression = require('compression');
const cluster = require('node:cluster');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const dbPath = path.join(__dirname, 'results.db');
const dbGzPath = path.join(__dirname, 'results.db.gz');

// Safe, Atomic Decompression Function
function ensureDbDecompressed() {
    if (!fs.existsSync(dbPath) && fs.existsSync(dbGzPath)) {
        try {
            console.log(`[Process ${process.pid}] 📦 Decompressing results.db.gz (76 MB -> 295 MB)... Please wait a few seconds.`);
            const compressedData = fs.readFileSync(dbGzPath);
            const decompressedData = zlib.gunzipSync(compressedData);
            const tempDbPath = path.join(__dirname, 'results.db.tmp');
            fs.writeFileSync(tempDbPath, decompressedData);
            if (fs.existsSync(tempDbPath)) {
                fs.renameSync(tempDbPath, dbPath);
            }
            console.log(`[Process ${process.pid}] ✅ Database decompressed successfully!`);
        } catch (decompErr) {
            console.error(`[Process ${process.pid}] ❌ Decompression error:`, decompErr);
        }
    }
}

// Enable Multi-core Cluster Mode for High Concurrency (Traffic Spikes)
const numCPUs = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;

if (cluster.isPrimary && !process.env.NO_CLUSTER && numCPUs > 1) {
    console.log(`🚀 Primary Cluster Master process ${process.pid} is running`);
    
    // Ensure Database is decompressed ONCE in Master before spawning workers
    ensureDbDecompressed();

    console.log(`⚡ Spawning ${numCPUs} worker processes to handle heavy traffic...`);
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        console.warn(`⚠️ Worker process ${worker.process.pid} exited. Respawning new worker...`);
        cluster.fork();
    });
} else {
    // Worker Process Execution
    ensureDbDecompressed();

    const app = express();

    // 1. High Performance Compression Middleware (Gzip/Brotli)
    app.use(compression());
    app.use(express.json());

    // 2. High Performance Static Asset Serving with Caching
    app.use(express.static(path.join(__dirname, 'public'), {
        maxAge: '7d',
        etag: true,
        lastModified: true
    }));

    // Connect to SQLite Database safely
    let db = null;
    let stmtGetBySeat = null;
    let stmtSearchSeatPrefix = null;
    let stmtFtsSearchByName = null;
    let stmtSearchByNameFallback = null;
    let stmtGetTop = null;
    let stmtGetStats = null;
    let stmtGetDistribution = null;
    let dbReady = false;

    function initDbWithRetry(maxRetries = 10) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (!fs.existsSync(dbPath)) return false;
                db = new DatabaseSync(dbPath, { readOnly: true });
                try {
                    db.exec(`
                        PRAGMA mmap_size = 300000000;
                        PRAGMA cache_size = -64000;
                        PRAGMA temp_store = MEMORY;
                    `);
                } catch (e) {}
                return true;
            } catch (err) {
                if (attempt === maxRetries) {
                    console.error(`[Worker ${process.pid}] ❌ Could not initialize DB after ${maxRetries} attempts:`, err.message);
                    return false;
                }
                const delay = Math.floor(Math.random() * 100) + 20;
                const start = Date.now();
                while (Date.now() - start < delay) {}
            }
        }
        return false;
    }

    try {
        if (initDbWithRetry()) {
            // Prepared SQL Statements
            stmtGetBySeat = db.prepare(`
                SELECT seating_no, arabic_name, total_degree, percentage, student_case_desc, rank
                FROM students
                WHERE seating_no = ?
            `);

            stmtSearchSeatPrefix = db.prepare(`
                SELECT seating_no, arabic_name, total_degree, percentage, student_case_desc, rank
                FROM students
                WHERE CAST(seating_no AS TEXT) LIKE ?
                ORDER BY seating_no ASC
                LIMIT 25
            `);

            stmtFtsSearchByName = db.prepare(`
                SELECT CAST(seating_no AS INTEGER) as seating_no, arabic_name, CAST(total_degree AS REAL) as total_degree, CAST(percentage AS REAL) as percentage, student_case_desc, CAST(student_rank AS INTEGER) as rank
                FROM students_fts
                WHERE arabic_name MATCH ?
                ORDER BY CAST(student_rank AS INTEGER) ASC
                LIMIT 25
            `);

            stmtSearchByNameFallback = db.prepare(`
                SELECT seating_no, arabic_name, total_degree, percentage, student_case_desc, rank
                FROM students
                WHERE arabic_name LIKE ?
                ORDER BY rank ASC
                LIMIT 25
            `);

            stmtGetTop = db.prepare(`
                SELECT seating_no, arabic_name, total_degree, percentage, student_case_desc, rank
                FROM students
                ORDER BY rank ASC, seating_no ASC
                LIMIT ?
            `);

            stmtGetStats = db.prepare(`SELECT key, value FROM stats`);

            stmtGetDistribution = db.prepare(`
                SELECT 
                    SUM(CASE WHEN percentage >= 90 THEN 1 ELSE 0 END) as range_90_100,
                    SUM(CASE WHEN percentage >= 85 AND percentage < 90 THEN 1 ELSE 0 END) as range_85_90,
                    SUM(CASE WHEN percentage >= 75 AND percentage < 85 THEN 1 ELSE 0 END) as range_75_85,
                    SUM(CASE WHEN percentage >= 65 AND percentage < 75 THEN 1 ELSE 0 END) as range_65_75,
                    SUM(CASE WHEN percentage >= 50 AND percentage < 65 THEN 1 ELSE 0 END) as range_50_65,
                    SUM(CASE WHEN percentage < 50 THEN 1 ELSE 0 END) as range_under_50
                FROM students
            `);

            dbReady = true;
            console.log(`[Worker ${process.pid}] ✅ Database loaded with MMAP & WAL performance mode.`);
        } else {
            console.warn(`[Worker ${process.pid}] ⚠️ Warning: results.db not found at:`, dbPath);
        }
    } catch (err) {
        console.error(`[Worker ${process.pid}] ❌ Error initializing database:`, err.message);
        dbReady = false;
    }

    // High Performance In-Memory Micro-Cache (Ultra-fast RAM response)
    const memoryCache = new Map();
    const MAX_CACHE_SIZE = 10000;

    function getFromCache(key) {
        return memoryCache.get(key) || null;
    }

    function setToCache(key, val) {
        if (memoryCache.size >= MAX_CACHE_SIZE) {
            const firstKey = memoryCache.keys().next().value;
            memoryCache.delete(firstKey);
        }
        memoryCache.set(key, val);
    }

    // Cache global stats in memory
    let cachedStats = null;
    let cachedDistribution = null;

    function loadStats() {
        if (!dbReady) return { total_students: 0, distribution: {} };
        if (!cachedStats) {
            const rows = stmtGetStats.all();
            cachedStats = {};
            for (const row of rows) {
                cachedStats[row.key] = row.value;
            }
        }
        if (!cachedDistribution) {
            cachedDistribution = stmtGetDistribution.get();
        }
        return { ...cachedStats, distribution: cachedDistribution };
    }

    // Healthcheck endpoint for Docker / Coolify / Reverse Proxy
    app.get('/health', (req, res) => {
        res.json({ status: 'ok', pid: process.pid, dbReady, uptime: process.uptime() });
    });

    // API Routes with RAM Caching & Edge-Cache headers

    // 1. Get student by seat number
    app.get('/api/student/:seat', (req, res) => {
        try {
            if (!dbReady) {
                return res.status(503).json({ success: false, message: 'قاعدة البيانات جاري إعدادها على الخادم، يرجى إعادة المحاولة خلال ثوانٍ.' });
            }
            const seatStr = req.params.seat;
            const cacheKey = `student:${seatStr}`;
            const cachedResult = getFromCache(cacheKey);

            if (cachedResult) {
                res.setHeader('X-Cache', 'HIT');
                res.setHeader('Cache-Control', 'public, max-age=3600');
                return res.json(cachedResult);
            }

            const seat = parseInt(seatStr, 10);
            if (isNaN(seat)) {
                return res.status(400).json({ success: false, message: 'رقم الجلوس يجب أن يكون رقماً صحيحاً' });
            }

            const student = stmtGetBySeat.get(seat);
            if (!student) {
                return res.status(404).json({ success: false, message: 'لم يتم العثور على نتيجة لهذا الرقم' });
            }

            const totalStudents = parseInt(loadStats().total_students, 10) || 919396;
            const percentile = ((1 - (student.rank / totalStudents)) * 100).toFixed(1);

            const responsePayload = {
                success: true,
                data: {
                    ...student,
                    max_degree: 320.0,
                    percentile: parseFloat(percentile),
                    total_students: totalStudents,
                    developer: "Ammar Nasr"
                }
            };

            setToCache(cacheKey, responsePayload);
            res.setHeader('X-Cache', 'MISS');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.json(responsePayload);
        } catch (err) {
            console.error('Error fetching student:', err);
            res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
        }
    });

    // 2. Ultra-fast Search by name or seat number
    app.get('/api/search', (req, res) => {
        try {
            if (!dbReady) {
                return res.status(503).json({ success: false, message: 'قاعدة البيانات جاري إعدادها على الخادم.' });
            }
            const query = (req.query.q || '').trim();
            if (!query || query.length < 2) {
                return res.json({ success: true, data: [] });
            }

            const cacheKey = `search:${query}`;
            const cachedSearch = getFromCache(cacheKey);
            if (cachedSearch) {
                res.setHeader('X-Cache', 'HIT');
                res.setHeader('Cache-Control', 'public, max-age=1800');
                return res.json(cachedSearch);
            }

            let results = [];
            if (/^\d+$/.test(query)) {
                const seatNum = parseInt(query, 10);
                const exactMatch = stmtGetBySeat.get(seatNum);
                if (exactMatch) {
                    results = [exactMatch];
                } else {
                    results = stmtSearchSeatPrefix.all(`${query}%`);
                }
            } else {
                try {
                    const ftsQuery = query.split(/\s+/).filter(Boolean).map(term => `${term}*`).join(' AND ');
                    results = stmtFtsSearchByName.all(ftsQuery);
                } catch (ftsErr) {
                    results = stmtSearchByNameFallback.all(`%${query}%`);
                }
                if (!results || results.length === 0) {
                    results = stmtSearchByNameFallback.all(`%${query}%`);
                }
            }

            const responsePayload = { success: true, count: results.length, data: results, developer: "Ammar Nasr" };
            setToCache(cacheKey, responsePayload);
            res.setHeader('X-Cache', 'MISS');
            res.setHeader('Cache-Control', 'public, max-age=1800');
            res.json(responsePayload);
        } catch (err) {
            console.error('Error searching:', err);
            res.status(500).json({ success: false, message: 'حدث خطأ في البحث' });
        }
    });

    // 3. Get Top Students Leaderboard
    app.get('/api/top', (req, res) => {
        try {
            if (!dbReady) {
                return res.status(503).json({ success: false, message: 'قاعدة البيانات جاري إعدادها على الخادم.' });
            }
            const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
            const cacheKey = `top:${limit}`;
            const cachedTop = getFromCache(cacheKey);
            if (cachedTop) {
                res.setHeader('X-Cache', 'HIT');
                res.setHeader('Cache-Control', 'public, max-age=86400');
                return res.json(cachedTop);
            }

            const topStudents = stmtGetTop.all(limit);
            const responsePayload = { success: true, count: topStudents.length, data: topStudents, developer: "Ammar Nasr" };
            setToCache(cacheKey, responsePayload);
            res.setHeader('X-Cache', 'MISS');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.json(responsePayload);
        } catch (err) {
            console.error('Error fetching top students:', err);
            res.status(500).json({ success: false, message: 'حدث خطأ أثناء جلب الأوائل' });
        }
    });

    // 4. Get Statistics
    app.get('/api/stats', (req, res) => {
        try {
            if (!dbReady) {
                return res.status(503).json({ success: false, message: 'قاعدة البيانات جاري إعدادها على الخادم.' });
            }
            const cacheKey = `stats:global`;
            const cachedStatsData = getFromCache(cacheKey);
            if (cachedStatsData) {
                res.setHeader('X-Cache', 'HIT');
                res.setHeader('Cache-Control', 'public, max-age=86400');
                return res.json(cachedStatsData);
            }

            const stats = loadStats();
            const responsePayload = { success: true, data: stats, developer: "Ammar Nasr" };
            setToCache(cacheKey, responsePayload);
            res.setHeader('X-Cache', 'MISS');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.json(responsePayload);
        } catch (err) {
            console.error('Error fetching stats:', err);
            res.status(500).json({ success: false, message: 'حدث خطأ أثناء جلب الإحصائيات' });
        }
    });

    // Start worker server
    app.listen(PORT, HOST, () => {
        console.log(`====================================================`);
        console.log(` [Worker ${process.pid}] Thanaweya Amma Server running on http://${HOST}:${PORT}`);
        console.log(` Developed by: Ammar Nasr`);
        console.log(`====================================================`);
    });
}
