// filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active-filter'));
        this.classList.add('active-filter');
        loadHistory(this.textContent.trim());
    });
});

async function loadHistory(filter = 'All') {
    const token = localStorage.getItem('token');
    const container = document.getElementById('history-list');

    try {
        const response = await fetch('http://localhost:5000/api/sessions', {
            headers: { 'Authorization': 'Bearer ' + token }
        });

        const sessions = await response.json();

        if (sessions.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>📭 No sessions yet.</p>
                    <p class="section-subtext">Complete your first study session to see your history here.</p>
                </div>`;
            return;
        }

        // filter sessions
        const now = new Date();
        const filtered = sessions.filter(session => {
            const sessionDate = new Date(session.completed_at);

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

        let html = '';
        filtered.forEach(session => {
            const date = new Date(session.completed_at).toLocaleDateString();
            html += `
                <div class="session-item">
                    <div>
                        <p style="color:#e2e8f0; font-size:14px;">${date} · ${session.study_minutes} min study / ${session.break_minutes} min break</p>
                        <p style="color:#94a3b8; font-size:12px;">${session.cycles} cycle(s) · ${session.sound || 'No sound'}</p>
                    </div>
                    <span class="badge-done">Done</span>
                </div>
            `;
        });

        container.innerHTML = html;

    } catch (error) {
        console.error('Failed to load history:', error);
        container.innerHTML = '<p class="section-subtext">Failed to load history.</p>';
    }
}

loadHistory();