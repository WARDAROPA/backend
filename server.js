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

app.post('/posts', async (req, res) => {
  const { usuario_id, descripcion, foto } = req.body;
  
  if (!usuario_id || !foto) {
    return res.status(400).json({ error: 'Usuario y foto son obligatorios' });
  }
  
  try {
    const [result] = await pool.query(
      'INSERT INTO posts (usuario_id, descripcion, foto) VALUES (?, ?, ?)',
      [usuario_id, descripcion || '', foto]
    );
    
    res.json({ 
      success: true, 
      message: 'Post creado correctamente',
      postId: result.insertId 
    });
  } catch (error) {
    console.error('Error al crear post:', error);
    res.status(500).json({ error: 'Error al crear post' });
  }
});

app.get('/posts', async (req, res) => {
  try {
    const [posts] = await pool.query(`
      SELECT 
        p.id,
        p.descripcion,
        p.foto,
        p.created_at,
        u.id as usuario_id,
        u.username,
        COUNT(DISTINCT l.id) as likes_count,
        COUNT(DISTINCT c.id) as comments_count
      FROM posts p
      INNER JOIN usuarios u ON p.usuario_id = u.id
      LEFT JOIN likes l ON p.id = l.post_id
      LEFT JOIN comentarios c ON p.id = c.post_id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);
    
    res.json({ success: true, posts });
  } catch (error) {
    console.error('Error al obtener posts:', error);
    res.status(500).json({ error: 'Error al obtener posts' });
  }
});

app.post('/posts/:postId/like', async (req, res) => {
  const { postId } = req.params;
  const { usuario_id } = req.body;
  
  if (!usuario_id) {
    return res.status(400).json({ error: 'Usuario es obligatorio' });
  }
  
  try {
    await pool.query(
      'INSERT INTO likes (post_id, usuario_id) VALUES (?, ?)',
      [postId, usuario_id]
    );
    
    res.json({ success: true, message: 'Like añadido' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'Ya has dado like a este post' });
    } else {
      console.error('Error al dar like:', error);
      res.status(500).json({ error: 'Error al dar like' });
    }
  }
});

app.delete('/posts/:postId/like', async (req, res) => {
  const { postId } = req.params;
  const { usuario_id } = req.body;
  
  if (!usuario_id) {
    return res.status(400).json({ error: 'Usuario es obligatorio' });
  }
  
  try {
    await pool.query(
      'DELETE FROM likes WHERE post_id = ? AND usuario_id = ?',
      [postId, usuario_id]
    );
    
    res.json({ success: true, message: 'Like eliminado' });
  } catch (error) {
    console.error('Error al eliminar like:', error);
    res.status(500).json({ error: 'Error al eliminar like' });
  }
});

app.post('/posts/:postId/comments', async (req, res) => {
  const { postId } = req.params;
  const { usuario_id, texto } = req.body;
  
  if (!usuario_id || !texto) {
    return res.status(400).json({ error: 'Usuario y texto son obligatorios' });
  }
  
  try {
    const [result] = await pool.query(
      'INSERT INTO comentarios (post_id, usuario_id, texto) VALUES (?, ?, ?)',
      [postId, usuario_id, texto]
    );
    
    res.json({ 
      success: true, 
      message: 'Comentario añadido',
      commentId: result.insertId 
    });
  } catch (error) {
    console.error('Error al añadir comentario:', error);
    res.status(500).json({ error: 'Error al añadir comentario' });
  }
});

app.get('/posts/:postId/comments', async (req, res) => {
  const { postId } = req.params;
  
  try {
    const [comments] = await pool.query(`
      SELECT 
        c.id,
        c.texto,
        c.created_at,
        u.id as usuario_id,
        u.username
      FROM comentarios c
      INNER JOIN usuarios u ON c.usuario_id = u.id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `, [postId]);
    
    res.json({ success: true, comments });
  } catch (error) {
    console.error('Error al obtener comentarios:', error);
    res.status(500).json({ error: 'Error al obtener comentarios' });
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
