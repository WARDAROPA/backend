import express from 'express';
import ExpressWs from 'express-ws';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;

const app = ExpressWs(express()).app;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.get('/', (req, res) => {
  res.json({ message: 'Bienvenido a Wardaropa API' });
});

app.ws('/', (connection, req) => {
  console.log('Usuario conectado via WebSocket');
  
  connection.send(JSON.stringify({ message: 'Conectado a Wardaropa' }));
  
  connection.on('message', (msg) => {
    console.log('Mensaje recibido:', msg);
    connection.send(JSON.stringify({ echo: msg }));
  });
  
  connection.on('close', () => {
    console.log('Usuario desconectado');
  });
});

app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).send('Error en el servidor');
});

app.listen(PORT, () => {
  console.log(`✓ Servidor Wardaropa corriendo en puerto ${PORT}`);
  console.log(`📋 Process ID: ${process.pid}`);
});
