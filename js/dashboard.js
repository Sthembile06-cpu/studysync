async function loadDashboardStats() {
    const token = localStorage.getItem('token');

    try {
        const response = await fetch('https://studysync-backend-we5u.onrender.com/api/sessions/stats', {
            headers: { 'Authorization': 'Bearer ' + token }
        });

        const data = await response.json();

        const totalMinutes = data.total_minutes || 0;
        const totalSessions = data.total_sessions || 0;
        const streak = parseInt(localStorage.getItem('streak')) || 0;

        document.getElementById('sessions-count').textContent = totalSessions;
        document.getElementById('hours-count').textContent = totalMinutes < 60
            ? totalMinutes + 'm'
            : (totalMinutes / 60).toFixed(1) + 'h';
        document.getElementById('streak-count').textContent = streak;

    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

async function loadRecentSessions() {
    const token = localStorage.getItem('token');
    const recentDiv = document.getElementById('recent-sessions');

    try {
        const response = await fetch('https://studysync-backend-we5u.onrender.com/api/sessions', {
            headers: { 'Authorization': 'Bearer ' + token }
        });

        const sessions = await response.json();

        if (sessions.length === 0) {
            recentDiv.innerHTML = '<p class="section-subtext">No sessions yet. Start your first session!</p>';
            return;
        }

        let html = '';
        sessions.slice(0, 5).forEach(session => {
            const date = new Date(session.completed_at).toLocaleDateString();
            html += `
                <div class="session-item">
                    <div>
                        <p style="color:#e2e8f0; font-size:14px;">${date} · ${session.study_minutes} min study / ${session.break_minutes} min break</p>
                        <p style="color:#94a3b8; font-size:12px;">${session.cycles} cycle(s)</p>
                    </div>
                    <span class="badge-done">Done</span>
                </div>
            `;
        });

        recentDiv.innerHTML = html;

    } catch (error) {
        console.error('Failed to load sessions:', error);
        recentDiv.innerHTML = '<p class="section-subtext">Failed to load sessions.</p>';
    }
}

loadDashboardStats();
loadRecentSessions();