const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "123").trim();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const checkAuth = (req, res, next) => {
    const pass = (req.headers['x-admin-pass'] || "").trim();
    if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Sai mật khẩu!' });
    next();
};

app.get('/api/questions', async (req, res) => {
    const { data } = await supabase.from('questions').select('*').order('sort_order', { ascending: true });
    res.json(data || []);
});

app.post('/api/questions', checkAuth, async (req, res) => {
    const { id, content, options, correct_indices, presets } = req.body;
    if (id) {
        const { error } = await supabase.from('questions').update({ content, options, correct_indices, presets }).eq('id', id);
        return res.json({ success: !error });
    }
    const { count } = await supabase.from('questions').select('*', { count: 'exact', head: true });
    const { error } = await supabase.from('questions').insert([{ content, options, correct_indices, presets: presets || [], sort_order: count || 0 }]);
    res.json({ success: !error });
});

app.delete('/api/questions/:id', checkAuth, async (req, res) => {
    const { error } = await supabase.from('questions').delete().eq('id', req.params.id);
    res.json({ success: !error });
});

app.post('/api/questions/reorder', checkAuth, async (req, res) => {
    const { orderedIds } = req.body;
    for (let i = 0; i < orderedIds.length; i++) {
        await supabase.from('questions').update({ sort_order: i }).eq('id', orderedIds[i]);
    }
    res.json({ success: true });
});

io.on('connection', (socket) => {
    socket.on('join_room', (data) => {
        if (!data.roomCode) return socket.emit('error_msg', 'Vui lòng nhập Mã Cổng!');
        const inputPass = (data.password || "").trim();
        if (data.role === 'host' && inputPass !== ADMIN_PASSWORD) return socket.emit('error_msg', 'Sai mật khẩu Admin!');
        socket.join(data.roomCode);
        socket.emit('join_success', { role: data.role });
    });
    socket.on('send_command', (data) => io.to(data.roomCode).emit('update_ui', data));
});

const PORT = process.env.PORT || 8080;
http.listen(PORT, '0.0.0.0', () => console.log(`Server Secure Ready on port ${PORT}`));
