// Script de prueba para verificar que el servidor funciona
const express = require('express');
const path = require('path');
const app = express();
const PORT = 3001; // Puerto diferente para prueba

app.use(express.static(__dirname));
app.use('/images', express.static(path.join(__dirname, 'images')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Test server running on http://localhost:${PORT}`);
    console.log('Si puedes ver esta página, el problema está en el servidor principal');
});

