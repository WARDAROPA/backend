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
const DEFAULT_N8N_POST_DESCRIPTION_WEBHOOK_URL = 'https://sql3.srv869945.hstgr.cloud/webhook/3717090c-f984-499d-b1b7-4820eb32970b';

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const allowedOrigins = ['http://localhost:4200', 'https://4.233.184.106', 'http://4.233.184.106', 'https://wardaropa.github.io'];
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
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
  const { usuario_id, descripcion, descripcion_prenda, foto } = req.body;
  
  if (!usuario_id || !foto) {
    return res.status(400).json({ error: 'Usuario y foto son obligatorios' });
  }
  
  try {
    const [result] = await pool.query(
      'INSERT INTO posts (usuario_id, descripcion, descripcion_prenda, foto) VALUES (?, ?, ?, ?)',
      [usuario_id, descripcion || '', descripcion_prenda || '', foto]
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
  const { usuario_id } = req.query;
  
  try {
    const [posts] = await pool.query(`
      SELECT 
        p.id,
        p.descripcion,
        p.descripcion_prenda,
        p.foto,
        p.created_at,
        u.id as usuario_id,
        u.username,
        COUNT(DISTINCT l.id) as likes_count,
        COUNT(DISTINCT c.id) as comments_count,
        ${usuario_id ? `MAX(CASE WHEN l.usuario_id = ? THEN 1 ELSE 0 END) as user_liked` : '0 as user_liked'}
      FROM posts p
      INNER JOIN usuarios u ON p.usuario_id = u.id
      LEFT JOIN likes l ON p.id = l.post_id
      LEFT JOIN comentarios c ON p.id = c.post_id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `, usuario_id ? [usuario_id] : []);
    
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

app.get('/users/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const [rows] = await pool.query(
      'SELECT id, username, email FROM usuarios WHERE id = ?',
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    res.json({ success: true, user: rows[0] });
  } catch (error) {
    console.error('Error al obtener usuario:', error);
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
});

app.get('/users/:id/posts', async (req, res) => {
  const { id } = req.params;
  
  try {
    const [posts] = await pool.query(`
      SELECT 
        p.id,
        p.descripcion,
        p.descripcion_prenda,
        p.foto,
        p.created_at,
        COUNT(DISTINCT l.id) as likes_count,
        COUNT(DISTINCT c.id) as comments_count
      FROM posts p
      LEFT JOIN likes l ON p.id = l.post_id
      LEFT JOIN comentarios c ON p.id = c.post_id
      WHERE p.usuario_id = ?
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `, [id]);
    
    res.json({ success: true, posts });
  } catch (error) {
    console.error('Error al obtener posts del usuario:', error);
    res.status(500).json({ error: 'Error al obtener posts del perfil' });
  }
});

app.post('/posts/:postId/ia-description', async (req, res) => {
  const { postId } = req.params;
  const { usuario_id } = req.body;

  if (!usuario_id) {
    return res.status(400).json({ error: 'Usuario es obligatorio' });
  }

  const webhookUrl = process.env.N8N_POST_DESCRIPTION_WEBHOOK_URL || DEFAULT_N8N_POST_DESCRIPTION_WEBHOOK_URL;
  if (!webhookUrl) {
    return res.status(500).json({ error: 'Webhook de n8n no configurado (N8N_POST_DESCRIPTION_WEBHOOK_URL)' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, usuario_id, descripcion, descripcion_prenda, foto FROM posts WHERE id = ? AND usuario_id = ? LIMIT 1',
      [postId, usuario_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Post no encontrado para este usuario' });
    }

    const post = rows[0];

    const webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        post_id: post.id,
        usuario_id: post.usuario_id,
        foto_base64: post.foto,
        pie_foto: post.descripcion,
        descripcion_prenda_actual: post.descripcion_prenda || ''
      })
    });

    if (!webhookResponse.ok) {
      return res.status(502).json({ error: 'Error al enviar el webhook a n8n' });
    }

    res.json({
      success: true,
      message: 'Webhook enviado. La descripcion IA se actualizara en breve.'
    });
  } catch (error) {
    console.error('Error al solicitar descripcion IA:', error);
    res.status(500).json({ error: 'Error al solicitar descripcion IA' });
  }
});


app.delete('/posts/:postId', async (req, res) => {
  const { postId } = req.params;
  const { usuario_id } = req.body; 
  
  if (!usuario_id) {
    return res.status(400).json({ error: 'Usuario es obligatorio para borrar' });
  }
  
  try {
    await pool.query('DELETE FROM likes WHERE post_id = ?', [postId]);
    await pool.query('DELETE FROM comentarios WHERE post_id = ?', [postId]);
    
    const [result] = await pool.query(
      'DELETE FROM posts WHERE id = ? AND usuario_id = ?',
      [postId, usuario_id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(403).json({ error: 'No autorizado o el post no existe' });
    }
    
    res.json({ success: true, message: 'Publicación borrada correctamente' });
  } catch (error) {
    console.error('Error al borrar post:', error);
    res.status(500).json({ error: 'Error al borrar la publicación' });
  }
});

app.ws('/api', (connection, req) => {
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

// ==================== NOTICIAS (FEEDS) ====================

// Obtener todas las noticias
app.get('/noticias', async (req, res) => {
  const { usuario_id, fuente } = req.query;

  try {
    let query = `
      SELECT 
        n.id,
        n.titulo,
        n.texto,
        n.imagen,
        n.fuente,
        n.created_at,
        n.usuario_id,
        u.username,
        COUNT(DISTINCT cn.id) as comments_count,
        COUNT(DISTINCT ln.id) as likes_count
        ${usuario_id ? `, MAX(CASE WHEN ln.usuario_id = ? THEN 1 ELSE 0 END) as user_liked` : ', 0 as user_liked'}
      FROM noticias n
      LEFT JOIN usuarios u ON n.usuario_id = u.id
      LEFT JOIN comentarios_noticias cn ON n.id = cn.noticia_id
      LEFT JOIN likes_noticias ln ON n.id = ln.noticia_id
    `;

    const params = [];
    if (usuario_id) params.push(usuario_id);

    if (fuente) {
      query += ` WHERE n.fuente = ?`;
      params.push(fuente);
    }

    query += ` GROUP BY n.id ORDER BY n.created_at DESC`;

    const [noticias] = await pool.query(query, params);
    res.json({ success: true, noticias });
  } catch (error) {
    console.error('Error al obtener noticias:', error);
    res.status(500).json({ error: 'Error al obtener noticias' });
  }
});

// Obtener una noticia por ID
app.get('/noticias/:id', async (req, res) => {
  const { id } = req.params;
  const { usuario_id } = req.query;

  try {
    const [rows] = await pool.query(`
      SELECT 
        n.id,
        n.titulo,
        n.texto,
        n.imagen,
        n.fuente,
        n.created_at,
        n.usuario_id,
        u.username,
        COUNT(DISTINCT cn.id) as comments_count,
        COUNT(DISTINCT ln.id) as likes_count
        ${usuario_id ? `, MAX(CASE WHEN ln.usuario_id = ? THEN 1 ELSE 0 END) as user_liked` : ', 0 as user_liked'}
      FROM noticias n
      LEFT JOIN usuarios u ON n.usuario_id = u.id
      LEFT JOIN comentarios_noticias cn ON n.id = cn.noticia_id
      LEFT JOIN likes_noticias ln ON n.id = ln.noticia_id
      WHERE n.id = ?
      GROUP BY n.id
    `, usuario_id ? [usuario_id, id] : [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Noticia no encontrada' });
    }

    res.json({ success: true, noticia: rows[0] });
  } catch (error) {
    console.error('Error al obtener noticia:', error);
    res.status(500).json({ error: 'Error al obtener noticia' });
  }
});

// Crear noticia (usuario)
app.post('/noticias', async (req, res) => {
  const { usuario_id, titulo, texto, imagen } = req.body;

  if (!titulo || !texto) {
    return res.status(400).json({ error: 'Título y texto son obligatorios' });
  }

  try {
    const fuente = usuario_id ? 'usuario' : 'n8n';
    const [result] = await pool.query(
      'INSERT INTO noticias (usuario_id, titulo, texto, imagen, fuente) VALUES (?, ?, ?, ?, ?)',
      [usuario_id || null, titulo, texto, imagen || null, fuente]
    );

    res.json({
      success: true,
      message: 'Noticia creada correctamente',
      noticiaId: result.insertId
    });
  } catch (error) {
    console.error('Error al crear noticia:', error);
    res.status(500).json({ error: 'Error al crear noticia' });
  }
});

// Eliminar noticia
app.delete('/noticias/:id', async (req, res) => {
  const { id } = req.params;
  const { usuario_id } = req.body;

  try {
    const [result] = await pool.query(
      'DELETE FROM noticias WHERE id = ? AND usuario_id = ?',
      [id, usuario_id]
    );

    if (result.affectedRows === 0) {
      return res.status(403).json({ error: 'No autorizado o la noticia no existe' });
    }

    res.json({ success: true, message: 'Noticia eliminada correctamente' });
  } catch (error) {
    console.error('Error al eliminar noticia:', error);
    res.status(500).json({ error: 'Error al eliminar noticia' });
  }
});

// Like noticia
app.post('/noticias/:id/like', async (req, res) => {
  const { id } = req.params;
  const { usuario_id } = req.body;

  if (!usuario_id) {
    return res.status(400).json({ error: 'Usuario es obligatorio' });
  }

  try {
    await pool.query(
      'INSERT INTO likes_noticias (noticia_id, usuario_id) VALUES (?, ?)',
      [id, usuario_id]
    );
    res.json({ success: true, message: 'Like añadido' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'Ya has dado like a esta noticia' });
    } else {
      console.error('Error al dar like:', error);
      res.status(500).json({ error: 'Error al dar like' });
    }
  }
});

// Unlike noticia
app.delete('/noticias/:id/like', async (req, res) => {
  const { id } = req.params;
  const { usuario_id } = req.body;

  if (!usuario_id) {
    return res.status(400).json({ error: 'Usuario es obligatorio' });
  }

  try {
    await pool.query(
      'DELETE FROM likes_noticias WHERE noticia_id = ? AND usuario_id = ?',
      [id, usuario_id]
    );
    res.json({ success: true, message: 'Like eliminado' });
  } catch (error) {
    console.error('Error al eliminar like:', error);
    res.status(500).json({ error: 'Error al eliminar like' });
  }
});

// Obtener comentarios de una noticia
app.get('/noticias/:id/comments', async (req, res) => {
  const { id } = req.params;

  try {
    const [comments] = await pool.query(`
      SELECT 
        cn.id,
        cn.texto,
        cn.created_at,
        u.id as usuario_id,
        u.username
      FROM comentarios_noticias cn
      INNER JOIN usuarios u ON cn.usuario_id = u.id
      WHERE cn.noticia_id = ?
      ORDER BY cn.created_at ASC
    `, [id]);

    res.json({ success: true, comments });
  } catch (error) {
    console.error('Error al obtener comentarios:', error);
    res.status(500).json({ error: 'Error al obtener comentarios' });
  }
});

// Crear comentario en noticia
app.post('/noticias/:id/comments', async (req, res) => {
  const { id } = req.params;
  const { usuario_id, texto } = req.body;

  if (!usuario_id || !texto) {
    return res.status(400).json({ error: 'Usuario y texto son obligatorios' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO comentarios_noticias (noticia_id, usuario_id, texto) VALUES (?, ?, ?)',
      [id, usuario_id, texto]
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

app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).send('Error en el servidor');
});

app.listen(PORT, async () => {
  console.log(`Servidor Wardaropa corriendo en puerto ${PORT}`);
  console.log(`Process ID: ${process.pid}`);
  await initDatabase();
});
