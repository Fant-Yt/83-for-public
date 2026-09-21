const socket = io();
let room = "", role = "", adminPass = "";
let currentEventId = null;
let currentLoadedQ = null;
let currentOptions = [];
let tvCorrectIndices = [];
let spinInterval = null;
let tvTimerInterval = null;

// --- BỘ ÂM THANH BẰNG WEB AUDIO API (KHÔNG CẦN TẢI FILE MP3) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    if (type === 'click') {
        osc.frequency.setValueAtTime(400, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        osc.start(now); osc.stop(now + 0.08);
    } else if (type === 'correct') {
        // Đô - Mi - Sol - Đố (Phấn khởi)
        [523, 659, 783, 1046].forEach((f, idx) => {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.connect(g); g.connect(audioCtx.destination);
            o.frequency.value = f;
            g.gain.setValueAtTime(0.15, now + idx*0.09);
            g.gain.exponentialRampToValueAtTime(0.001, now + idx*0.09 + 0.3);
            o.start(now + idx*0.09); o.stop(now + idx*0.09 + 0.3);
        });
    } else if (type === 'wrong') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.linearRampToValueAtTime(90, now + 0.3);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now); osc.stop(now + 0.3);
    } else if (type === 'tick') {
        osc.frequency.setValueAtTime(800, now);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now); osc.stop(now + 0.05);
    }
}

// Pháo hoa ăn mừng
function triggerConfetti() {
    const end = Date.now() + 2500;
    (function frame() {
        confetti({ particleCount: 6, angle: 60, spread: 55, origin: { x: 0 } });
        confetti({ particleCount: 6, angle: 120, spread: 55, origin: { x: 1 } });
        if (Date.now() < end) requestAnimationFrame(frame);
    }());
}

// --- KẾT NỐI VÀ VÀO PHÒNG ---
socket.on('error_msg', m => alert(m));

function join(r) {
    room = document.getElementById('room-in').value.trim();
    adminPass = document.getElementById('pass-in').value.trim();
    if (!room) return alert("Vui lòng nhập Mã phòng!");
    socket.emit('join_room', { role: r, roomCode: room, password: adminPass });
}

socket.on('join_success', d => {
    role = d.role;
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById(role + '-screen').classList.remove('hidden');

    if (d.state && d.state.theme) {
        document.body.setAttribute('data-theme', d.state.theme);
    }

    if (role === 'host') {
        loadEvents();
    } else if (role === 'display') {
        // Tự khôi phục trạng thái nếu TV reload
        restoreTVState(d.state);
    }
});

// Đổi theme giao diện
function changeTheme(themeName) {
    document.body.setAttribute('data-theme', themeName);
    socket.emit('send_command', { roomCode: room, type: 'set_theme', theme: themeName });
}

// --- QUẢN LÝ SỰ KIỆN (EVENTS) ---
async function loadEvents() {
    const res = await fetch('/api/events');
    const events = await res.json();
    const select = document.getElementById('event-selector');
    select.innerHTML = '';
    
    events.forEach(ev => {
        const opt = document.createElement('option');
        opt.value = ev.id;
        opt.dataset.theme = ev.theme;
        opt.innerText = ev.name;
        select.appendChild(opt);
    });

    if (events.length > 0) {
        currentEventId = events[0].id;
        changeTheme(events[0].theme);
        loadQuestions();
    }
}

function onEventChange() {
    const select = document.getElementById('event-selector');
    const selectedOpt = select.options[select.selectedIndex];
    currentEventId = select.value;
    changeTheme(selectedOpt.dataset.theme);
    loadQuestions();
}

// --- QUẢN LÝ CÂU HỎI (QUESTIONS) ---
async function loadQuestions() {
    if (!currentEventId) return;
    const res = await fetch(`/api/questions?eventId=${currentEventId}`);
    const data = await res.json();

    const listManage = document.getElementById('sortable-area'); listManage.innerHTML = '';
    const listCtrl = document.getElementById('play-list'); listCtrl.innerHTML = '';
    const pickerZoneCtrl = document.getElementById('picker-zone-ctrl'); pickerZoneCtrl.innerHTML = '';
    
    let counter = 1;
    data.forEach((q) => {
        if (q.content === '@RANDOM_PICKER') {
            const pbCtrl = document.createElement('div');
            pbCtrl.style.cssText = "background: rgba(255,183,3,0.15); border: 2px dashed var(--accent); padding: 12px; border-radius: 12px; margin-bottom: 12px; display:flex; justify-content:space-between; align-items:center;";
            pbCtrl.innerHTML = `
                <div style="font-weight:bold; color:var(--accent);">🎲 VÒNG QUAY (${q.options.length} người)</div>
                <button onclick='triggerSpin(${JSON.stringify(q)})' style="background:var(--accent); color:#000; border:none; padding:8px 15px; border-radius:6px; font-weight:bold;">QUAY</button>
            `;
            pickerZoneCtrl.appendChild(pbCtrl);
        } else {
            // Danh sách bên Quản lý
            const itemManage = document.createElement('div');
            itemManage.style.cssText = "background:rgba(255,255,255,0.08); padding:14px; border-radius:10px; margin-bottom:8px; display:flex; align-items:center;";
            itemManage.dataset.id = q.id;
            itemManage.innerHTML = `
                <div style="flex:1; font-weight:700; cursor:pointer;" onclick='openModal(${JSON.stringify(q)})'>Câu ${counter}: ${q.content}</div>
                <button onclick="del(${q.id})" style="background:none; border:none; color:#ff4d6d; font-weight:bold;">Xóa</button>
            `;
            listManage.appendChild(itemManage);

            // Danh sách bên Điều khiển
            const pbCtrl = document.createElement('div');
            pbCtrl.style.cssText = "background:rgba(255,255,255,0.06); padding:12px; border-radius:12px; margin-bottom:10px;";
            
            let h = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-weight:700; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Câu ${counter}: ${q.content}</div>
                    <select onchange='handlePlayMenu(this, ${JSON.stringify(q)})' style="background:var(--accent); color:#000; font-weight:bold; border-radius:6px; padding:6px; border:none;">
                        <option value="" disabled selected>Phát</option>
                        <option value="ALL">Tất cả đáp án</option>
                        <option value="STEP">Phát tuần tự</option>
                    </select>
                </div>
            `;
            pbCtrl.innerHTML = h;
            listCtrl.appendChild(pbCtrl);
            counter++;
        }
    });
}

// --- ADMIN ĐIỀU KHIỂN PHÁT CÂU HỎI ---
function handlePlayMenu(elem, q) {
    const v = elem.value;
    if (!v) return;

    currentLoadedQ = q;
    currentOptions = q.options;
    tvCorrectIndices = q.correct_indices;
    const isStep = (v === "STEP");

    document.getElementById('now-p').innerText = q.content;
    document.getElementById('live-btns').classList.remove('hidden');
    document.getElementById('btn-reveal-next').classList.toggle('hidden', !isStep);

    // Vẽ danh sách đáp án trên màn hình điện thoại của Admin
    renderAdminOptions(q.options);

    socket.emit('send_command', {
        roomCode: room,
        type: 'load',
        q: q,
        isStepByStep: isStep
    });

    elem.selectedIndex = 0;
}

// Hiển thị các đáp án trên điện thoại để Admin bấm chọn hộ TV
function renderAdminOptions(opts) {
    const box = document.getElementById('admin-options-container');
    box.innerHTML = '';
    opts.forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.className = 'admin-opt-btn';
        btn.id = `admin-opt-${idx}`;
        btn.innerText = `${String.fromCharCode(65 + idx)}. ${opt}`;
        btn.onclick = () => selectOptionFromAdmin(idx);
        box.appendChild(btn);
    });
}

function selectOptionFromAdmin(idx) {
    playSound('click');
    document.querySelectorAll('.admin-opt-btn').forEach((b, i) => {
        b.classList.toggle('active', i === idx);
    });
    socket.emit('send_command', {
        roomCode: room,
        type: 'select_option',
        index: idx
    });
}

function triggerSpin(q) {
    const winner = q.options[Math.floor(Math.random() * q.options.length)];
    document.getElementById('now-p').innerText = "Đang quay thưởng...";
    socket.emit('send_command', {
        roomCode: room,
        type: 'spin_wheel',
        names: q.options,
        winner: winner
    });
}

function sendStandby() {
    document.getElementById('now-p').innerText = "Đang ở Màn hình chờ...";
    document.getElementById('live-btns').classList.add('hidden');
    document.getElementById('admin-options-container').innerHTML = '';
    socket.emit('send_command', { roomCode: room, type: 'standby' });
}

function startTimer(sec) {
    socket.emit('send_command', { roomCode: room, type: 'start_timer', seconds: sec });
}

function sendStep(action) {
    socket.emit('send_command', { roomCode: room, type: 'step', step: action });
}

// --- LOGIC HIỂN THỊ TRÊN TIVI (DISPLAY) ---
socket.on('update_ui', d => {
    if (d.type === 'set_theme') {
        document.body.setAttribute('data-theme', d.theme);
        return;
    }

    if (role !== 'display') return;

    const tt = document.getElementById('tv-title');
    const g = document.getElementById('tv-grid');
    const timerEl = document.getElementById('tv-timer');

    if (d.type === 'standby') {
        clearInterval(spinInterval);
        clearInterval(tvTimerInterval);
        timerEl.classList.add('hidden');
        g.innerHTML = '';
        tt.innerText = "CHÀO MỪNG ĐẾN VỚI SỰ KIỆN";
        tt.className = '';
        return;
    }

    if (d.type === 'start_timer') {
        clearInterval(tvTimerInterval);
        let s = d.seconds;
        timerEl.innerText = s;
        timerEl.classList.remove('hidden', 'timer-pulse');
        
        tvTimerInterval = setInterval(() => {
            s--;
            playSound('tick');
            timerEl.innerText = s;
            if (s <= 3) timerEl.classList.add('timer-pulse');
            if (s <= 0) {
                clearInterval(tvTimerInterval);
                timerEl.innerText = "HẾT GIỜ!";
                playSound('wrong');
            }
        }, 1000);
        return;
    }

    if (d.type === 'spin_wheel') {
        clearInterval(spinInterval);
        timerEl.classList.add('hidden');
        g.innerHTML = '';
        tt.className = 'spinning-text';
        let count = 0;
        spinInterval = setInterval(() => {
            playSound('tick');
            tt.innerText = d.names[Math.floor(Math.random() * d.names.length)];
            if (++count > 25) {
                clearInterval(spinInterval);
                tt.className = 'winner-text';
                tt.innerText = `🎉 ${d.winner} 🎉`;
                playSound('correct');
                triggerConfetti();
            }
        }, 90);
        return;
    }

    if (d.type === 'load') {
        clearInterval(spinInterval);
        clearInterval(tvTimerInterval);
        timerEl.classList.add('hidden');
        tt.className = '';
        tt.innerText = d.q.content;
        tvCorrectIndices = d.q.correct_indices;
        g.innerHTML = '';

        d.q.options.forEach((opt, i) => {
            const c = document.createElement('div');
            c.className = 'cell';
            c.id = `tv-opt-${i}`;
            c.innerText = `${String.fromCharCode(65 + i)}. ${opt}`;
            
            if (d.isStepByStep) {
                c.classList.add('hidden-cell');
            } else {
                c.classList.add('pop-in');
                c.style.animationDelay = (i * 0.1) + 's';
            }
            g.appendChild(c);
        });
        return;
    }

    if (d.type === 'select_option') {
        playSound('click');
        document.querySelectorAll('.cell').forEach((c, i) => {
            c.classList.toggle('selected', i === d.index);
        });
        return;
    }

    if (d.type === 'step') {
        if (d.step === 'reveal_next') {
            const hidden = document.querySelector('.cell.hidden-cell');
            if (hidden) {
                hidden.classList.remove('hidden-cell');
                hidden.classList.add('pop-in');
                playSound('click');
            }
        } else if (d.step === 'check_choice') {
            const s = document.querySelector('.cell.selected');
            if (!s) return;
            const idx = parseInt(s.id.split('-')[2]);
            const isOk = tvCorrectIndices.includes(idx);
            
            s.classList.remove('selected');
            if (isOk) {
                s.classList.add('correct');
                playSound('correct');
                triggerConfetti();
                document.querySelectorAll('.cell').forEach(c => { if (c !== s) c.classList.add('faded'); });
            } else {
                s.classList.add('wrong');
                playSound('wrong');
                setTimeout(() => s.classList.add('faded'), 500);
            }
        } else if (d.step === 'reveal_correct') {
            document.querySelectorAll('.cell').forEach((c, idx) => {
                c.classList.remove('selected');
                if (tvCorrectIndices.includes(idx)) {
                    c.classList.add('correct');
                } else {
                    c.classList.add('faded');
                }
            });
            playSound('correct');
            triggerConfetti();
        }
    }
});

// Khôi phục màn hình TV khi rớt mạng hoặc refresh
function restoreTVState(state) {
    if (!state || state.currentView === 'standby') return;
    if (state.currentView === 'question' && state.currentQ) {
        socket.emit('send_command', {
            roomCode: room,
            type: 'load',
            q: state.currentQ,
            isStepByStep: false
        });
    }
}

// Modal Thêm/Xóa
function switchTab(t) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.innerText.includes(t==='ctrl'?'ĐIỀU':'QUẢN')));
    document.getElementById('tab-ctrl').classList.toggle('hidden', t !== 'ctrl');
    document.getElementById('tab-list').classList.toggle('hidden', t !== 'list');
}

function openModal(q = null) {
    document.getElementById('modal-box').classList.remove('hidden');
    document.getElementById('opt-box').innerHTML = '';
    if (q) {
        document.getElementById('edit-id').value = q.id;
        document.getElementById('edit-text').value = q.content;
        q.options.forEach((o, i) => addOptRow(o, q.correct_indices.includes(i)));
    } else {
        document.getElementById('edit-id').value = '';
        document.getElementById('edit-text').value = '';
        for (let i = 0; i < 4; i++) addOptRow();
    }
}
function closeModal() { document.getElementById('modal-box').classList.add('hidden'); }

function addOptRow(val = '', isCorrect = false) {
    const r = document.createElement('div');
    r.style.cssText = "display:flex; gap:10px; margin-bottom:8px; align-items:center;";
    r.innerHTML = `
        <input type="checkbox" style="width:20px; height:20px;" ${isCorrect ? 'checked' : ''}>
        <input type="text" value="${val}" placeholder="Đáp án..." style="flex:1; padding:8px; border-radius:6px; border:1px solid #555; background:#2c283e; color:#fff;">
        <button onclick="this.parentElement.remove()" style="color:#ff4d6d; background:none; border:none; font-weight:bold;">X</button>
    `;
    document.getElementById('opt-box').appendChild(r);
}

async function saveQ() {
    const opts = [], idxs = [];
    document.querySelectorAll('#opt-box > div').forEach((r, i) => {
        const txt = r.querySelector('input[type="text"]').value.trim();
        if (txt) {
            opts.push(txt);
            if (r.querySelector('input[type="checkbox"]').checked) idxs.push(opts.length - 1);
        }
    });

    if (opts.length === 0) return alert("Vui lòng nhập đáp án!");
    if (idxs.length === 0) return alert("Phải tích chọn ít nhất 1 đáp án đúng!");

    await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-pass': adminPass },
        body: JSON.stringify({
            id: document.getElementById('edit-id').value || null,
            event_id: currentEventId,
            content: document.getElementById('edit-text').value,
            options: opts,
            correct_indices: idxs
        })
    });
    closeModal();
    loadQuestions();
}

async function del(id) {
    if (!confirm("Chắc chắn xóa câu này?")) return;
    await fetch(`/api/questions/${id}`, {
        method: 'DELETE',
        headers: { 'x-admin-pass': adminPass }
    });
    loadQuestions();
}