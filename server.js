import express from 'express';
import ExpressWs from 'express-ws';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import pool, { initDatabase } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = ExpressWs(express()).app;
const PORT = 3000;

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

app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const [result] = await pool.query(
      'INSERT INTO usuarios (username, email, password) VALUES (?, ?, ?)',
      [username, email, hashedPassword]
    );
    
    res.json({ 
      success: true, 
      message: 'Usuario registrado correctamente',
      userId: result.insertId 
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'El usuario o email ya existe' });
    } else {
      console.error('Error en registro:', error);
      res.status(500).json({ error: 'Error al registrar usuario' });
    }
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios' });
  }
  
  try {
    const [rows] = await pool.query(
      'SELECT * FROM usuarios WHERE username = ?',
      [username]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    
    const user = rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    
    res.json({ 
      success: true, 
      message: 'Login exitoso',
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
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

app.listen(PORT, async () => {
  console.log(`Servidor Wardaropa corriendo en puerto ${PORT}`);
  console.log(`Process ID: ${process.pid}`);
  await initDatabase();
});
