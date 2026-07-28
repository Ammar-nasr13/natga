import sqlite3
import pandas as pd
import numpy as np
import os
import time

excel_path = '961260179546020نتيجة_ثانوية_عامة_نظام_حديث.xlsx'
db_path = 'results.db'

print("Starting Excel conversion to SQLite database...")
start_time = time.time()

# 1. Read Excel file
print("Reading Excel file...")
df = pd.read_excel(excel_path)
print(f"Loaded {len(df):,} records in {time.time() - start_time:.2f} seconds.")

# Clean columns and column names if needed
df['seating_no'] = df['seating_no'].astype(int)
df['arabic_name'] = df['arabic_name'].astype(str).str.strip()
df['total_degree'] = df['total_degree'].fillna(0.0).astype(float)
df['student_case_desc'] = df['student_case_desc'].astype(str).str.strip()

# Calculate percentage (max score is 320.0)
df['percentage'] = (df['total_degree'] / 320.0 * 100).round(2)

# Calculate nationwide rank (method='min' descending by total_degree)
print("Calculating nationwide rankings...")
df['rank'] = df['total_degree'].rank(method='min', ascending=False).astype(int)

# Create SQLite database
if os.path.exists(db_path):
    os.remove(db_path)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Enable WAL mode for high performance concurrent reads
cursor.execute("PRAGMA journal_mode = WAL;")
cursor.execute("PRAGMA synchronous = NORMAL;")

print("Creating table schema...")
cursor.execute("""
CREATE TABLE students (
    seating_no INTEGER PRIMARY KEY,
    arabic_name TEXT NOT NULL,
    total_degree REAL NOT NULL,
    percentage REAL NOT NULL,
    student_case_desc TEXT NOT NULL,
    rank INTEGER NOT NULL
);
""")

print("Inserting data into SQLite...")
df.to_sql('students', conn, if_exists='append', index=False)

print("Creating database indexes for lightning-fast lookups...")
index_start = time.time()
cursor.execute("CREATE INDEX idx_arabic_name ON students(arabic_name);")
cursor.execute("CREATE INDEX idx_rank ON students(rank);")

# Compute overall statistics
print("Computing dataset statistics...")
total_students = len(df)
passed_count = int((df['student_case_desc'].str.contains('ناجح')).sum())
second_round_count = int((df['student_case_desc'].str.contains('دور ثان')).sum())
failed_count = int((df['student_case_desc'].str.contains('راسب')).sum())
avg_score = float(df['total_degree'].mean())
avg_percentage = float(df['percentage'].mean())

cursor.execute("""
CREATE TABLE stats (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
""")

stats_data = [
    ('total_students', str(total_students)),
    ('passed_count', str(passed_count)),
    ('second_round_count', str(second_round_count)),
    ('failed_count', str(failed_count)),
    ('avg_score', f"{avg_score:.2f}"),
    ('avg_percentage', f"{avg_percentage:.2f}")
]

cursor.executemany("INSERT INTO stats VALUES (?, ?)", stats_data)

conn.commit()
conn.close()

print(f"Database build complete in {time.time() - start_time:.2f} seconds!")
print(f"File created: {db_path}")
