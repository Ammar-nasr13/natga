const express = require('express');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const dbPath = path.join(__dirname, 'results.db');
const dbGzPath = path.join(__dirname, 'results.db.gz');

// Auto-decompress results.db.gz if results.db is missing
if (!fs.existsSync(dbPath) && fs.existsSync(dbGzPath)) {
    try {
        console.log('📦 Decompressing results.db.gz (76 MB -> 295 MB)... Please wait a few seconds.');
        const compressedData = fs.readFileSync(dbGzPath);
        const decompressedData = zlib.gunzipSync(compressedData);
        fs.writeFileSync(dbPath, decompressedData);
        console.log('✅ Database decompressed successfully to results.db!');
    } catch (decompErr) {
        console.error('❌ Failed to decompress results.db.gz:', decompErr);
    }
}

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

try {
    if (fs.existsSync(dbPath)) {
        db = new DatabaseSync(dbPath);
        
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
        console.log('✅ Database results.db loaded successfully.');
    } else {
        console.warn('⚠️ Warning: results.db file not found at:', dbPath);
    }
} catch (err) {
    console.error('❌ Error initializing database:', err.message);
    dbReady = false;
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
    res.json({ status: 'ok', dbReady, uptime: process.uptime() });
});

// API Routes

// 1. Get student by seat number
app.get('/api/student/:seat', (req, res) => {
    try {
        if (!dbReady) {
            return res.status(503).json({ success: false, message: 'قاعدة البيانات جاري فك ضغطها أو غير متوفرة حالياً.' });
        }
        const seat = parseInt(req.params.seat, 10);
        if (isNaN(seat)) {
            return res.status(400).json({ success: false, message: 'رقم الجلوس يجب أن يكون رقماً صحيحاً' });
        }

        const student = stmtGetBySeat.get(seat);
        if (!student) {
            return res.status(404).json({ success: false, message: 'لم يتم العثور على نتيجة لهذا الرقم' });
        }

        const totalStudents = parseInt(loadStats().total_students, 10) || 919396;
        const percentile = ((1 - (student.rank / totalStudents)) * 100).toFixed(1);

        res.json({
            success: true,
            data: {
                ...student,
                max_degree: 320.0,
                percentile: parseFloat(percentile),
                total_students: totalStudents,
                developer: "Ammar Nasr"
            }
        });
    } catch (err) {
        console.error('Error fetching student:', err);
        res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
    }
});

// 2. Ultra-fast Search by name or seat number
app.get('/api/search', (req, res) => {
    try {
        if (!dbReady) {
            return res.status(503).json({ success: false, message: 'قاعدة البيانات غير متوفرة حالياً' });
        }
        const query = (req.query.q || '').trim();
        if (!query || query.length < 2) {
            return res.json({ success: true, data: [] });
        }

        let results = [];
        if (/^\d+$/.test(query)) {
            // Numeric query: check exact seat first
            const seatNum = parseInt(query, 10);
            const exactMatch = stmtGetBySeat.get(seatNum);
            if (exactMatch) {
                results = [exactMatch];
            } else {
                results = stmtSearchSeatPrefix.all(`${query}%`);
            }
        } else {
            // Text query: try FTS5 first, fallback to LIKE
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

        res.json({ success: true, count: results.length, data: results, developer: "Ammar Nasr" });
    } catch (err) {
        console.error('Error searching:', err);
        res.status(500).json({ success: false, message: 'حدث خطأ في البحث' });
    }
});

// 3. Get Top Students
app.get('/api/top', (req, res) => {
    try {
        if (!dbReady) {
            return res.status(503).json({ success: false, message: 'قاعدة البيانات غير متوفرة حالياً' });
        }
        const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
        const topStudents = stmtGetTop.all(limit);
        res.json({ success: true, count: topStudents.length, data: topStudents, developer: "Ammar Nasr" });
    } catch (err) {
        console.error('Error fetching top students:', err);
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء جلب الأوائل' });
    }
});

// 4. Get Statistics
app.get('/api/stats', (req, res) => {
    try {
        if (!dbReady) {
            return res.status(503).json({ success: false, message: 'قاعدة البيانات غير متوفرة حالياً' });
        }
        const stats = loadStats();
        res.json({ success: true, data: stats, developer: "Ammar Nasr" });
    } catch (err) {
        console.error('Error fetching stats:', err);
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء جلب الإحصائيات' });
    }
});

// Start server listening on all network interfaces
app.listen(PORT, HOST, () => {
    console.log(`====================================================`);
    console.log(` Thanaweya Amma Results Server running on http://${HOST}:${PORT}`);
    console.log(` Developed by: Ammar Nasr`);
    console.log(`====================================================`);
});
