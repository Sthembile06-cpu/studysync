// initialise EmailJS
emailjs.init('lJ7xPChV05RRJg8KA');

let selectedRating = 0;

const ratingLabels = {
    1: 'Poor — needs a lot of work',
    2: 'Fair — some things to improve',
    3: 'Good — I enjoy using it',
    4: 'Great — really helpful!',
    5: 'Excellent — absolutely love it! ⭐'
};

// star rating
document.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', function() {
        selectedRating = parseInt(this.dataset.value);

        document.querySelectorAll('.star').forEach((s, index) => {
            s.classList.toggle('active', index < selectedRating);
        });

        document.getElementById('rating-label').textContent = ratingLabels[selectedRating];
    });

    star.addEventListener('mouseover', function() {
        const value = parseInt(this.dataset.value);
        document.querySelectorAll('.star').forEach((s, index) => {
            s.style.opacity = index < value ? '1' : '0.3';
        });
    });

    star.addEventListener('mouseout', function() {
        document.querySelectorAll('.star').forEach((s, index) => {
            s.style.opacity = index < selectedRating ? '1' : '0.3';
        });
    });
});

// submit feedback
document.getElementById('submit-feedback-btn').addEventListener('click', async function() {
    const category = document.getElementById('feedback-category').value;
    const message = document.getElementById('feedback-message').value.trim();
    const email = document.getElementById('feedback-email').value.trim();
    const user = JSON.parse(localStorage.getItem('user'));

    if (!message) {
        alert('Please write a message before submitting');
        return;
    }

    if (selectedRating === 0) {
        alert('Please select a star rating');
        return;
    }

    // disable button while sending
    this.textContent = 'Sending...';
    this.disabled = true;

    try {
        // send email via EmailJS
        await emailjs.send('service_gnb8kac', 'template_xq0p8mg', {
            user_name: user ? user.name : 'Anonymous',
            from_email: email || 'Not provided',
            rating: selectedRating,
            category: category,
            message: message,
            date: new Date().toLocaleDateString()
        });

        // save to localStorage
        const feedbackList = JSON.parse(localStorage.getItem('feedbackList')) || [];
        feedbackList.push({
            rating: selectedRating,
            category,
            message,
            email,
            date: new Date().toLocaleDateString()
        });
        localStorage.setItem('feedbackList', JSON.stringify(feedbackList));

        // show success
        document.getElementById('feedback-success').style.display = 'block';
        document.getElementById('feedback-message').value = '';
        document.getElementById('feedback-email').value = '';
        selectedRating = 0;
        document.querySelectorAll('.star').forEach(s => s.classList.remove('active'));
        document.getElementById('rating-label').textContent = 'Click to rate';

        this.textContent = 'Send Feedback';
        this.disabled = false;

        loadPreviousFeedback();

    } catch (error) {
        console.error('EmailJS error:', error);
        alert('Failed to send feedback. Please try again.');
        this.textContent = 'Send Feedback';
        this.disabled = false;
    }
});

function loadPreviousFeedback() {
    const feedbackList = JSON.parse(localStorage.getItem('feedbackList')) || [];
    const container = document.getElementById('previous-feedback');

    if (feedbackList.length === 0) {
        container.innerHTML = '<p class="section-subtext">No feedback submitted yet.</p>';
        return;
    }

    let html = '';
    feedbackList.slice().reverse().forEach(fb => {
        const stars = '⭐'.repeat(fb.rating);
        html += `
            <div class="session-item" style="flex-direction:column; align-items:flex-start; gap:5px;">
                <div style="display:flex; justify-content:space-between; width:100%;">
                    <span style="color:#e2e8f0; font-size:14px;">${stars} ${fb.category}</span>
                    <span style="color:#475569; font-size:12px;">${fb.date}</span>
                </div>
                <p style="color:#94a3b8; font-size:13px;">${fb.message}</p>
            </div>
        `;
    });

    container.innerHTML = html;
}

loadPreviousFeedback();