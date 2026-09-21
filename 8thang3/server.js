const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "12345678";

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Thiếu cấu hình Supabase!");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const verifyAdmin = (req, res, next) => {
    if (req.headers['x-admin-pass'] === ADMIN_PASSWORD) {
        next();
    } else {
        res.status(401).json({ error: "Sai mật khẩu Admin!" });
    }
};

// --- QUẢN LÝ TRẠNG THÁI PHÒNG (Khôi phục khi TV reload) ---
const roomStates = {}; 

function getRoomState(room) {
    if (!roomStates[room]) {
        roomStates[room] = {
            theme: 'midautumn',
            currentView: 'standby', // 'standby' | 'question' | 'wheel'
            currentQ: null,
            activePreset: null,
            isStepByStep: false,
            revealedCount: 0,
            selectedOptionIndex: null,
            revealedCorrect: false,
            winner: null
        };
    }
    return roomStates[room];
}

// --- APIs: QUẢN LÝ SỰ KIỆN (EVENTS) ---
app.get('/api/events', async (req, res) => {
    const { data, error } = await supabase.from('events').select('*').order('id', { ascending: true });
    if (error) return res.status(500).json(error);
    res.json(data);
});

app.post('/api/events', verifyAdmin, async (req, res) => {
    const { name, slug, theme } = req.body;
    const { data, error } = await supabase.from('events').insert([{ name, slug, theme }]).select();
    if (error) return res.status(500).json(error);
    res.json(data[0]);
});

// --- APIs: QUẢN LÝ CÂU HỎI THEO EVENT ---
app.get('/api/questions', async (req, res) => {
    const { eventId } = req.query;
    let query = supabase.from('questions').select('*').order('sort_order', { ascending: true, nullsFirst: false });
    if (eventId) query = query.eq('event_id', eventId);
    
    const { data, error } = await query;
    if (error) return res.status(500).json(error);
    res.json(data);
});

app.post('/api/questions', verifyAdmin, async (req, res) => {
    const q = req.body;
    const payload = {
        event_id: q.event_id,
        content: q.content,
        options: q.options,
        correct_indices: q.correct_indices,
        presets: q.presets || []
    };

    let result;
    if (q.id) {
        result = await supabase.from('questions').update(payload).eq('id', q.id);
    } else {
        const { data: lastQ } = await supabase
            .from('questions')
            .select('sort_order')
            .eq('event_id', q.event_id)
            .not('sort_order', 'is', null)
            .order('sort_order', { descending: true })
            .limit(1);
            
        payload.sort_order = (lastQ && lastQ.length > 0) ? lastQ[0].sort_order + 1 : 0;
        result = await supabase.from('questions').insert([payload]);
    }

    if (result.error) return res.status(500).json(result.error);
    res.json({ success: true });
});

app.delete('/api/questions/:id', verifyAdmin, async (req, res) => {
    const { error } = await supabase.from('questions').delete().eq('id', req.params.id);
    if (error) return res.status(500).json(error);
    res.json({ success: true });
});

app.post('/api/questions/reorder', verifyAdmin, async (req, res) => {
    const { orderedIds } = req.body;
    const updates = orderedIds.map((id, index) => 
        supabase.from('questions').update({ sort_order: index }).eq('id', id)
    );
    await Promise.all(updates);
    res.json({ success: true });
});

// --- SOCKET.IO REALTIME ---
io.on('connection', (socket) => {
    socket.on('join_room', (data) => {
        const { role, roomCode, password } = data;
        if (role === 'host' && password !== ADMIN_PASSWORD) {
            return socket.emit('error_msg', 'Sai mật khẩu Quản trị!');
        }
        
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.role = role;

        const state = getRoomState(roomCode);
        socket.emit('join_success', { role, roomCode, state });
    });

    socket.on('send_command', (data) => {
        const room = data.roomCode;
        if (!room) return;
        const state = getRoomState(room);

        // Lưu vết trạng thái
        if (data.type === 'standby') {
            state.currentView = 'standby';
            state.currentQ = null;
        } else if (data.type === 'load') {
            state.currentView = 'question';
            state.currentQ = data.q;
            state.activePreset = data.active_preset;
            state.isStepByStep = data.isStepByStep;
            state.revealedCount = data.isStepByStep ? 0 : (data.active_preset ? data.active_preset.length : data.q.options.length);
            state.selectedOptionIndex = null;
            state.revealedCorrect = false;
        } else if (data.type === 'spin_wheel') {
            state.currentView = 'wheel';
            state.winner = data.winner;
        } else if (data.type === 'select_option') {
            state.selectedOptionIndex = data.index;
        } else if (data.type === 'set_theme') {
            state.theme = data.theme;
        }

        io.to(room).emit('update_ui', data);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Event Engine chạy tại port ${PORT}`));
