function loadDashboardStats() {
    const sessions = parseInt(localStorage.getItem('totalSessions')) || 0;
    const hours = parseFloat(localStorage.getItem('totalHours')) || 0;
    const streak = parseInt(localStorage.getItem('streak')) || 0;

    document.getElementById('sessions-count').textContent = sessions;
    document.getElementById('hours-count').textContent = hours < 1 
        ? Math.round(hours * 60) + 'm' 
        : hours + 'h';
    document.getElementById('streak-count').textContent = streak;
}

function loadRecentSessions() {
    const recentDiv = document.getElementById('recent-sessions');
    const history = JSON.parse(localStorage.getItem('sessionHistory')) || [];

    if (history.length === 0) {
        recentDiv.innerHTML = '<p class="section-subtext">No sessions yet. Start your first session!</p>';
        return;
    }

    let html = '';
    history.slice(-5).reverse().forEach(session => {
        html += `
            <div class="session-item">
                <span>${session.date} · ${session.study} study / ${session.break} break · ${session.cycles} cycle(s)</span>
                <span class="badge-done">Done</span>
            </div>
        `;
    });

    recentDiv.innerHTML = html;
}

loadDashboardStats();
loadRecentSessions();