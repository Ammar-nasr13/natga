// Thanaweya Amma Results Portal Client Application
document.addEventListener('DOMContentLoaded', () => {
    // Safely query DOM elements
    const navButtons = document.querySelectorAll('.nav-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const themeToggleBtn = document.getElementById('theme-toggle');
    
    const modeSeatBtn = document.getElementById('mode-seat-btn');
    const modeNameBtn = document.getElementById('mode-name-btn');
    const seatSearchForm = document.getElementById('seat-search-form');
    const nameSearchForm = document.getElementById('name-search-form');

    const seatInput = document.getElementById('seat-input');
    const nameInput = document.getElementById('name-input');
    const suggestionsBox = document.getElementById('suggestions-box');

    const resultContainer = document.getElementById('result-container');
    const multipleResultsContainer = document.getElementById('multiple-results-container');
    const resultsTableBody = document.getElementById('results-table-body');
    const resultsCountEl = document.getElementById('results-count');

    const printBtn = document.getElementById('print-btn');
    const shareBtn = document.getElementById('share-btn');

    // Custom UI Alert Modal Handler (Replaces browser alert)
    function showAlert(message, type = 'warning', title = 'تنبيه') {
        const modal = document.getElementById('custom-alert-modal');
        const modalTitle = document.getElementById('custom-alert-title');
        const modalMsg = document.getElementById('custom-alert-message');
        const modalIcon = document.getElementById('custom-alert-icon');
        const closeBtn = document.getElementById('custom-alert-close-btn');

        if (!modal) return;

        if (modalTitle) modalTitle.textContent = title;
        if (modalMsg) modalMsg.textContent = message;

        if (modalIcon) {
            modalIcon.className = `modal-icon-badge ${type}`;
            if (type === 'error') {
                modalIcon.innerHTML = `<i class="fa-solid fa-circle-xmark"></i>`;
            } else if (type === 'success') {
                modalIcon.innerHTML = `<i class="fa-solid fa-circle-check"></i>`;
            } else if (type === 'info') {
                modalIcon.innerHTML = `<i class="fa-solid fa-circle-info"></i>`;
            } else {
                modalIcon.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i>`;
            }
        }

        modal.style.display = 'flex';

        const handleClose = () => {
            modal.style.display = 'none';
            closeBtn.removeEventListener('click', handleClose);
        };

        if (closeBtn) {
            closeBtn.addEventListener('click', handleClose);
        }
    }

    // Toast Notification Helper
    function showToast(message) {
        let toast = document.querySelector('.toast-notification');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'toast-notification';
            toast.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span class="toast-msg"></span>`;
            document.body.appendChild(toast);
        }
        toast.querySelector('.toast-msg').textContent = message;
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    // 1. Navigation Tabs Switcher
    if (navButtons.length > 0) {
        navButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.getAttribute('data-tab');
                
                navButtons.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => {
                    c.classList.remove('active');
                    c.style.display = 'none';
                });

                btn.classList.add('active');
                const activeTab = document.getElementById(targetTab);
                if (activeTab) {
                    activeTab.style.display = 'block';
                    activeTab.classList.add('active');
                }

                if (targetTab === 'top-tab') {
                    loadTopStudents();
                } else if (targetTab === 'stats-tab') {
                    loadGlobalStats();
                }
            });
        });
    }

    // 2. Search Mode Switcher (Seat Number vs Name)
    if (modeSeatBtn && modeNameBtn) {
        modeSeatBtn.addEventListener('click', () => {
            modeSeatBtn.classList.add('active');
            modeNameBtn.classList.remove('active');
            if (seatSearchForm) seatSearchForm.style.display = 'block';
            if (nameSearchForm) nameSearchForm.style.display = 'none';
            if (suggestionsBox) suggestionsBox.style.display = 'none';
            if (seatInput) seatInput.focus();
        });

        modeNameBtn.addEventListener('click', () => {
            modeNameBtn.classList.add('active');
            modeSeatBtn.classList.remove('active');
            if (nameSearchForm) nameSearchForm.style.display = 'block';
            if (seatSearchForm) seatSearchForm.style.display = 'none';
            if (nameInput) nameInput.focus();
        });
    }

    // Auto-scroll input into view when mobile virtual keyboard opens
    [seatInput, nameInput].forEach(input => {
        if (input) {
            input.addEventListener('focus', () => {
                setTimeout(() => {
                    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 300);
            });
        }
    });

    // 3. Theme Toggle Switcher (Safely guarded)
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            document.body.classList.toggle('dark-theme');
            const isDark = document.body.classList.contains('dark-theme');
            themeToggleBtn.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
        });
    }

    // 4. Seat Search Form Handler
    if (seatSearchForm && seatInput) {
        seatSearchForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const seat = seatInput.value.trim();
            if (!seat) {
                showAlert('برجاء إدخال رقم الجلوس أولاً قبل البحث', 'warning', 'تنبيه');
                return;
            }

            showLoader(seatSearchForm);
            try {
                const res = await fetch(`/api/student/${encodeURIComponent(seat)}`);
                const data = await res.json();
                
                if (data.success && data.data) {
                    displayStudentCertificate(data.data);
                    if (multipleResultsContainer) multipleResultsContainer.style.display = 'none';
                } else {
                    showAlert(data.message || 'عذراً، لم نتمكن من العثور على نتيجة لهذا الرقم. التأكد من رقم الجلوس والمحاولة مجدداً.', 'error', 'عذراً، لا توجد نتيجة');
                    if (resultContainer) resultContainer.style.display = 'none';
                }
            } catch (err) {
                console.error('Fetch error:', err);
                showAlert('حدث خطأ في الاتصال بالخادم، يرجى إعادة المحاولة', 'error', 'خطأ خادم');
            } finally {
                hideLoader(seatSearchForm);
            }
        });
    }

    // 5. Name Search Auto-Suggest & Form Handler
    let debounceTimer = null;
    if (nameInput) {
        nameInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            const q = nameInput.value.trim();
            if (q.length < 2) {
                if (suggestionsBox) suggestionsBox.style.display = 'none';
                return;
            }

            debounceTimer = setTimeout(async () => {
                try {
                    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
                    const data = await res.json();
                    if (data.success && data.data && data.data.length > 0) {
                        renderSuggestions(data.data);
                    } else {
                        if (suggestionsBox) suggestionsBox.style.display = 'none';
                    }
                } catch (err) {
                    console.error('Suggest error:', err);
                }
            }, 250);
        });
    }

    if (nameSearchForm && nameInput) {
        nameSearchForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (suggestionsBox) suggestionsBox.style.display = 'none';
            const q = nameInput.value.trim();
            if (!q) {
                showAlert('برجاء كتابة اسم الطالب أولاً', 'warning', 'تنبيه');
                return;
            }

            showLoader(nameSearchForm);
            try {
                const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
                const data = await res.json();

                if (data.success && data.data && data.data.length > 0) {
                    if (data.data.length === 1) {
                        // Single match -> fetch certificate
                        const single = data.data[0];
                        fetchStudentBySeat(single.seating_no);
                        if (multipleResultsContainer) multipleResultsContainer.style.display = 'none';
                    } else {
                        // Multiple matches -> render list
                        renderMultipleResults(data.data);
                        if (resultContainer) resultContainer.style.display = 'none';
                    }
                } else {
                    showAlert('لم يتم العثور على أي طالب يطابق هذا الاسم. يرجى التأكد من طريقة كتابة الاسم.', 'error', 'لا توجد نتائج');
                    if (resultContainer) resultContainer.style.display = 'none';
                    if (multipleResultsContainer) multipleResultsContainer.style.display = 'none';
                }
            } catch (err) {
                console.error('Search error:', err);
                showAlert('حدث خطأ أثناء البحث عن الاسم', 'error', 'خطأ');
            } finally {
                hideLoader(nameSearchForm);
            }
        });
    }

    // Render Auto Suggestions
    function renderSuggestions(students) {
        if (!suggestionsBox) return;
        suggestionsBox.innerHTML = '';
        students.slice(0, 6).forEach(stu => {
            const item = document.createElement('div');
            item.className = 'suggestion-item';
            item.innerHTML = `
                <span class="sug-name">${stu.arabic_name}</span>
                <span class="sug-seat">#${stu.seating_no} (${stu.total_degree} درجة)</span>
            `;
            item.addEventListener('click', () => {
                if (nameInput) nameInput.value = stu.arabic_name;
                suggestionsBox.style.display = 'none';
                fetchStudentBySeat(stu.seating_no);
            });
            suggestionsBox.appendChild(item);
        });
        suggestionsBox.style.display = 'block';
    }

    // Render Multiple Results Table
    function renderMultipleResults(students) {
        if (!resultsTableBody || !multipleResultsContainer) return;
        resultsTableBody.innerHTML = '';
        if (resultsCountEl) resultsCountEl.textContent = students.length;

        students.forEach(stu => {
            const tr = document.createElement('tr');
            const isPass = stu.student_case_desc.includes('ناجح');
            const badgeClass = isPass ? 'passed' : (stu.student_case_desc.includes('دور') ? 'second-round' : 'failed');

            tr.innerHTML = `
                <td><strong>${stu.seating_no}</strong></td>
                <td>${stu.arabic_name}</td>
                <td><strong>${stu.total_degree}</strong> / 320</td>
                <td><span style="font-family:var(--font-en); font-weight:700;">${stu.percentage}%</span></td>
                <td><span class="cert-badge ${badgeClass}" style="padding:0.2rem 0.8rem; font-size:0.8rem;">${stu.student_case_desc}</span></td>
                <td>#${stu.rank.toLocaleString('ar-EG')}</td>
                <td>
                    <button class="secondary-btn view-btn" style="padding:0.3rem 0.8rem; font-size:0.8rem;" data-seat="${stu.seating_no}">
                        <i class="fa-solid fa-eye"></i> عرض
                    </button>
                </td>
            `;

            tr.querySelector('.view-btn').addEventListener('click', () => {
                fetchStudentBySeat(stu.seating_no);
            });

            resultsTableBody.appendChild(tr);
        });

        multipleResultsContainer.style.display = 'block';
        multipleResultsContainer.scrollIntoView({ behavior: 'smooth' });
    }

    async function fetchStudentBySeat(seat) {
        try {
            const res = await fetch(`/api/student/${seat}`);
            const data = await res.json();
            if (data.success && data.data) {
                displayStudentCertificate(data.data);
                if (multipleResultsContainer) multipleResultsContainer.style.display = 'none';
            } else {
                showAlert(data.message || 'عذراً، لم يتم العثور على النتيجة', 'error', 'تنبيه');
            }
        } catch (err) {
            console.error('Error fetching student:', err);
            showAlert('حدث خطأ أثناء تحميل تفاصيل الطالب', 'error', 'خطأ');
        }
    }

    // Display Student Certificate Card & Confetti
    function displayStudentCertificate(student) {
        if (!resultContainer) return;

        const nameEl = document.getElementById('res-name');
        const seatEl = document.getElementById('res-seat');
        const rankEl = document.getElementById('res-rank');
        const percentageEl = document.getElementById('res-percentage');
        const scoreEl = document.getElementById('res-score');
        const caseBadge = document.getElementById('case-badge');

        if (nameEl) nameEl.textContent = student.arabic_name;
        if (seatEl) seatEl.textContent = student.seating_no;
        if (rankEl) rankEl.textContent = `#${student.rank.toLocaleString('ar-EG')}`;
        if (percentageEl) percentageEl.textContent = `${student.percentage}%`;
        if (scoreEl) scoreEl.textContent = student.total_degree;

        if (caseBadge) {
            caseBadge.textContent = student.student_case_desc;
            caseBadge.className = 'cert-badge';

            const isPassed = student.student_case_desc.includes('ناجح');
            if (isPassed) {
                caseBadge.classList.add('passed');
                if (typeof confetti === 'function') {
                    confetti({
                        particleCount: 80,
                        spread: 60,
                        origin: { y: 0.6 }
                    });
                }
            } else if (student.student_case_desc.includes('دور')) {
                caseBadge.classList.add('second-round');
            } else {
                caseBadge.classList.add('failed');
            }
        }

        // Circular Gauge Offset
        const circle = document.getElementById('gauge-fill-circle');
        if (circle) {
            const strokeDashOffset = 440 - (440 * (student.percentage / 100));
            circle.style.strokeDashoffset = strokeDashOffset;
        }

        // Score Bar Fill
        const barFill = document.getElementById('score-bar-fill');
        if (barFill) {
            barFill.style.width = `${student.percentage}%`;
        }

        resultContainer.style.display = 'block';
        resultContainer.scrollIntoView({ behavior: 'smooth' });
    }

    // Load Top Students Leaderboard
    let topStudentsLoaded = false;
    async function loadTopStudents() {
        if (topStudentsLoaded) return;
        const tbody = document.getElementById('top-table-body');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> جاري تحميل قائمة الأوائل...</td></tr>';

        try {
            const res = await fetch('/api/top?limit=50');
            const data = await res.json();

            if (data.success && data.data && data.data.length > 0) {
                tbody.innerHTML = '';
                data.data.forEach((stu, index) => {
                    const rankNum = index + 1;
                    let rankBadgeClass = 'other';
                    if (rankNum === 1) rankBadgeClass = 'top-1';
                    else if (rankNum === 2) rankBadgeClass = 'top-2';
                    else if (rankNum === 3) rankBadgeClass = 'top-3';

                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><span class="rank-badge ${rankBadgeClass}">${rankNum}</span></td>
                        <td><strong>${stu.arabic_name}</strong></td>
                        <td>${stu.seating_no}</td>
                        <td><strong>${stu.total_degree}</strong> / 320</td>
                        <td><span style="font-family:var(--font-en); font-weight:700;">${stu.percentage}%</span></td>
                        <td><span class="cert-badge passed" style="padding:0.2rem 0.8rem; font-size:0.8rem;">${stu.student_case_desc}</span></td>
                    `;
                    tbody.appendChild(tr);
                });
                topStudentsLoaded = true;
            } else {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--warning-amber);"><i class="fa-solid fa-clock"></i> ${data.message || 'جاري تجهيز قائمة الأوائل على الخادم، يرجى الضغط مرة أخرى خلال ثوانٍ.'}</td></tr>`;
            }
        } catch (err) {
            console.error('Top students error:', err);
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--danger-red);"><i class="fa-solid fa-circle-exclamation"></i> حدث خطأ أثناء تحميل الأوائل. يرجى الضغط مرة أخرى.</td></tr>';
        }
    }

    // Load Global Stats
    let globalStatsLoaded = false;
    async function loadGlobalStats() {
        if (globalStatsLoaded) return;
        try {
            const res = await fetch('/api/stats');
            const data = await res.json();

            if (data.success && data.data) {
                const stats = data.data;
                const elTotal = document.getElementById('stat-total');
                const elPassed = document.getElementById('stat-passed');
                const elSecond = document.getElementById('stat-second');
                const elFailed = document.getElementById('stat-failed');

                if (elTotal) elTotal.textContent = parseInt(stats.total_students).toLocaleString('ar-EG');
                if (elPassed) elPassed.textContent = parseInt(stats.passed_count).toLocaleString('ar-EG');
                if (elSecond) elSecond.textContent = parseInt(stats.second_round_count).toLocaleString('ar-EG');
                if (elFailed) elFailed.textContent = parseInt(stats.failed_count).toLocaleString('ar-EG');

                // Render Distribution Bars
                const dist = stats.distribution;
                const total = parseInt(stats.total_students, 10);
                const distBarsContainer = document.getElementById('dist-bars');
                if (distBarsContainer && dist) {
                    distBarsContainer.innerHTML = '';
                    const ranges = [
                        { label: '90% - 100% (ممتاز مرتفع)', count: dist.range_90_100, color: 'var(--navy-primary)' },
                        { label: '85% - 90% (ممتاز)', count: dist.range_85_90, color: 'var(--accent-blue)' },
                        { label: '75% - 85% (جيد جداً)', count: dist.range_75_85, color: '#4F46E5' },
                        { label: '65% - 75% (جيد)', count: dist.range_65_75, color: '#7C3AED' },
                        { label: '50% - 65% (مقبول)', count: dist.range_50_65, color: 'var(--warning-amber)' },
                        { label: 'أقل من 50% (دور ثان/راسب)', count: dist.range_under_50, color: 'var(--danger-red)' }
                    ];

                    ranges.forEach(r => {
                        const pct = ((r.count / total) * 100).toFixed(1);
                        const row = document.createElement('div');
                        row.className = 'dist-row';
                        row.innerHTML = `
                            <div class="dist-meta">
                                <span>${r.label}</span>
                                <span>${parseInt(r.count).toLocaleString('ar-EG')} طالب (${pct}%)</span>
                            </div>
                            <div class="dist-bar-outer">
                                <div class="dist-bar-inner" style="width: ${pct}%; background: ${r.color};"></div>
                            </div>
                        `;
                        distBarsContainer.appendChild(row);
                    });
                }

                globalStatsLoaded = true;
            }
        } catch (err) {
            console.error('Stats error:', err);
        }
    }

    // PDF Download & Native Print Handler
    if (printBtn) {
        printBtn.addEventListener('click', () => {
            const element = document.getElementById('printable-certificate');
            const seatEl = document.getElementById('res-seat');
            const seatNum = seatEl ? seatEl.textContent.trim() : 'student';

            if (typeof html2pdf === 'function') {
                showToast('جاري تجهيز وتحميل ملف الـ PDF...');
                const noPrintEls = element.querySelectorAll('.no-print');
                noPrintEls.forEach(el => el.style.display = 'none');

                const opt = {
                    margin: [8, 8, 8, 8],
                    filename: `نتيجة_الثانوية_العامة_${seatNum}.pdf`,
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: { scale: 2, useCORS: true },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
                };

                html2pdf().set(opt).from(element).save().then(() => {
                    noPrintEls.forEach(el => el.style.display = 'flex');
                }).catch(err => {
                    console.error('PDF generation error:', err);
                    noPrintEls.forEach(el => el.style.display = 'flex');
                    window.print();
                });
            } else {
                window.print();
            }
        });
    }

    // Native Mobile Web Share & Clipboard Fallback Handler
    if (shareBtn) {
        shareBtn.addEventListener('click', async () => {
            const nameEl = document.getElementById('res-name');
            const seatEl = document.getElementById('res-seat');
            const percentageEl = document.getElementById('res-percentage');
            const scoreEl = document.getElementById('res-score');
            const rankEl = document.getElementById('res-rank');
            const caseBadge = document.getElementById('case-badge');

            const studentName = nameEl ? nameEl.textContent : '';
            const seatNo = seatEl ? seatEl.textContent : '';
            const percentage = percentageEl ? percentageEl.textContent : '';
            const score = scoreEl ? scoreEl.textContent : '';
            const rank = rankEl ? rankEl.textContent : '';
            const status = caseBadge ? caseBadge.textContent : '';

            const shareTitle = `نتيجة الطالب ${studentName} - الثانوية العامة 2026`;
            const shareText = `🎓 نتيجة الثانوية العامة 2026\n👤 الطالب: ${studentName}\n🔢 رقم الجلوس: ${seatNo}\n📊 النسبة: ${percentage} (${score}/320)\n👑 الترتيب: ${rank}\n📌 الحالة: ${status}\n\nتم الاستعلام عبر موقع Eng. Ammar Nasr:`;
            const shareUrl = window.location.href;

            if (navigator.share) {
                try {
                    await navigator.share({
                        title: shareTitle,
                        text: shareText,
                        url: shareUrl
                    });
                } catch (err) {
                    // User canceled share or unsupported
                }
            } else if (navigator.clipboard) {
                navigator.clipboard.writeText(`${shareText}\n${shareUrl}`).then(() => {
                    showToast('تم نسخ تفاصيل النتيجة بنجاح!');
                });
            } else {
                showToast('تم إعداد تفاصيل النتيجة للمشاركة');
            }
        });
    }

    // UI Loaders
    function showLoader(form) {
        const btnText = form.querySelector('.btn-text');
        const btnLoader = form.querySelector('.btn-loader');
        if (btnText) btnText.style.display = 'none';
        if (btnLoader) btnLoader.style.display = 'inline-block';
    }

    function hideLoader(form) {
        const btnText = form.querySelector('.btn-text');
        const btnLoader = form.querySelector('.btn-loader');
        if (btnText) btnText.style.display = 'inline-block';
        if (btnLoader) btnLoader.style.display = 'none';
    }
});
