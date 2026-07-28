import sqlite3
import time

conn = sqlite3.connect('results.db')
cursor = conn.cursor()

print("Building FTS5 full-text search index for lightning fast name search...")
start_time = time.time()

cursor.execute("PRAGMA journal_mode = WAL;")
cursor.execute("PRAGMA synchronous = NORMAL;")

# Drop old FTS table if exists
cursor.execute("DROP TABLE IF EXISTS students_fts;")

# Create FTS5 virtual table using unicode61 tokenizer with remove_diacritics
cursor.execute("""
CREATE VIRTUAL TABLE students_fts USING fts5(
    seating_no UNINDEXED,
    arabic_name,
    total_degree UNINDEXED,
    percentage UNINDEXED,
    student_case_desc UNINDEXED,
    student_rank UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
);
""")

print("Populating FTS5 index from students table...")
cursor.execute("""
INSERT INTO students_fts(seating_no, arabic_name, total_degree, percentage, student_case_desc, student_rank)
SELECT seating_no, arabic_name, total_degree, percentage, student_case_desc, rank FROM students;
""")

conn.commit()

# Test FTS query speed
t0 = time.time()
cursor.execute("SELECT seating_no, arabic_name, total_degree, percentage, student_case_desc, student_rank AS rank FROM students_fts WHERE arabic_name MATCH ? ORDER BY CAST(student_rank AS INTEGER) ASC LIMIT 25;", ('عمار*',))
rows = cursor.fetchall()
t1 = time.time()

print(f"FTS Search found {len(rows)} rows in {(t1-t0)*1000:.3f} ms!")
print("Sample FTS result:", rows[0] if rows else None)

conn.close()
print(f"FTS5 build completed in {time.time() - start_time:.2f} seconds!")
