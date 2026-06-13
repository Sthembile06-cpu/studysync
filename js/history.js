// filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active-filter'));
        this.classList.add('active-filter');
        loadHistory(this.textContent.trim());
    });
});

function loadHistory(filter = 'All') {
    const history = JSON.parse(localStorage.getItem('sessionHistory')) || [];
    const container = document.getElementById('history-list');

    if (history.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>📭 No sessions yet.</p>
                <p class="section-subtext">Complete your first study session to see your history here.</p>
            </div>`;
        return;
    }

    // filter sessions
    const now = new Date();
    const filtered = history.filter(session => {
        const sessionDate = new Date(session.date);

        if (filter === 'This week') {
            const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
            return sessionDate >= weekAgo;
        } else if (filter === 'This month') {
            return sessionDate.getMonth() === now.getMonth() &&
                   sessionDate.getFullYear() === now.getFullYear();
        }
        return true;
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>📭 No sessions found.</p>
                <p class="section-subtext">No sessions for this time period.</p>
            </div>`;
        return;
    }

    // display sessions newest first
    let html = '';
    filtered.slice().reverse().forEach(session => {
        html += `
            <div class="session-item">
                <div>
                    <p style="color:#e2e8f0; font-size:14px;">${session.date} · ${session.study} study / ${session.break} break</p>
                    <p style="color:#94a3b8; font-size:12px;">${session.cycles} cycle(s)</p>
                </div>
                <span class="badge-done">Done</span>
            </div>
        `;
    });

    container.innerHTML = html;
}

// load on page open
loadHistory();