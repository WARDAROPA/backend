import express from 'express';
import ExpressWs from 'express-ws';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import pool, { initDatabase } from './database.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = ExpressWs(express()).app;
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_key';
const DEFAULT_N8N_POST_DESCRIPTION_WEBHOOK_URL = process.env.N8N_POST_DESCRIPTION_WEBHOOK_URL || '';
const DEFAULT_N8N_POST_MATCH_WEBHOOK_URL = process.env.N8N_POST_MATCH_WEBHOOK_URL || '';
const DEFAULT_N8N_OUTFIT_WEBHOOK_URL = process.env.N8N_OUTFIT_WEBHOOK_URL || '';
const DEFAULT_N8N_OUTFIT_TRYON_WEBHOOK_URL = process.env.N8N_OUTFIT_TRYON_WEBHOOK_URL || '';

// Middleware de autenticación JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token de autenticación requerido' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido o expirado' });
    }
    req.user = decoded;
    next();
  });
}

app.use((req, res, next) => {
  const allowedOrigins = ['http://localhost:4200', 'https://4.233.184.106', 'http://4.233.184.106', 'https://wardaropa.github.io'];
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

app.use(bodyParser.json({ limit: '20mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '20mb' }));

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
    
    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ 
      success: true, 
      message: 'Login exitoso',
      token,
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

app.post('/posts', authenticateToken, async (req, res) => {
  const usuario_id = req.user.id;
  const { descripcion, descripcion_prenda, foto } = req.body;
  
  if (!foto) {
    return res.status(400).json({ error: 'Foto es obligatoria' });
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
  const parsedLimit = Number(req.query.limit);
  const parsedOffset = Number(req.query.offset);
  const limit = Number.isInteger(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, 30)
    : 12;
  const offset = Number.isInteger(parsedOffset) && parsedOffset >= 0
    ? parsedOffset
    : 0;
  const queryLimit = limit + 1;
  
  try {
    const baseParams = [queryLimit, offset];
    const userLikedJoin = usuario_id
      ? 'LEFT JOIN likes ul ON ul.post_id = p.id AND ul.usuario_id = ?'
      : '';
    const userLikedSelect = usuario_id
      ? 'CASE WHEN ul.post_id IS NULL THEN 0 ELSE 1 END as user_liked'
      : '0 as user_liked';
    const params = usuario_id ? [queryLimit, offset, Number(usuario_id)] : baseParams;

    const [posts] = await pool.query(
      `
      SELECT
        p.id,
        p.descripcion,
        p.descripcion_prenda,
        p.created_at,
        u.id as usuario_id,
        u.username,
        COALESCE(l.likes_count, 0) as likes_count,
        COALESCE(c.comments_count, 0) as comments_count,
        ${userLikedSelect}
      FROM (
        SELECT id, usuario_id, descripcion, descripcion_prenda, created_at
        FROM posts
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      ) p
      INNER JOIN usuarios u ON p.usuario_id = u.id
      LEFT JOIN (
        SELECT post_id, COUNT(*) as likes_count
        FROM likes
        GROUP BY post_id
      ) l ON l.post_id = p.id
      LEFT JOIN (
        SELECT post_id, COUNT(*) as comments_count
        FROM comentarios
        GROUP BY post_id
      ) c ON c.post_id = p.id
      ${userLikedJoin}
      ORDER BY p.created_at DESC
      `,
      params
    );

    const hasMore = posts.length > limit;
    const slicedPosts = hasMore ? posts.slice(0, limit) : posts;
    
    res.json({ success: true, posts: slicedPosts, hasMore });
  } catch (error) {
    console.error('Error al obtener posts:', error);
    res.status(500).json({ error: 'Error al obtener posts' });
  }
});

app.post('/posts/:postId/like', authenticateToken, async (req, res) => {
  const { postId } = req.params;
  const usuario_id = req.user.id;
  
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

app.delete('/posts/:postId/like', authenticateToken, async (req, res) => {
  const { postId } = req.params;
  const usuario_id = req.user.id;
  
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

app.post('/posts/:postId/comments', authenticateToken, async (req, res) => {
  const { postId } = req.params;
  const usuario_id = req.user.id;
  const { texto } = req.body;
  
  if (!texto) {
    return res.status(400).json({ error: 'Texto es obligatorio' });
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

// Eliminar un comentario de un post
app.delete('/comments/:commentId', authenticateToken, async (req, res) => {
  const { commentId } = req.params;
  const usuario_id = req.user.id;

  try {
    const [rows] = await pool.query(`
      SELECT c.usuario_id as comment_owner, p.usuario_id as post_owner 
      FROM comentarios c 
      JOIN posts p ON c.post_id = p.id 
      WHERE c.id = ?
    `, [commentId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Comentario no encontrado' });
    }

    const { comment_owner, post_owner } = rows[0];

    if (usuario_id !== comment_owner && usuario_id !== post_owner) {
      return res.status(403).json({ error: 'No tienes permiso para borrar este comentario' });
    }

    await pool.query('DELETE FROM comentarios WHERE id = ?', [commentId]);
    res.json({ success: true, message: 'Comentario eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar comentario:', error);
    res.status(500).json({ error: 'Error al eliminar comentario' });
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

app.get('/users/:id/outfits', async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await pool.query(
      `
      SELECT
        o.id,
        o.nombre,
        o.created_at,
        oi.slot,
        p.id as post_id,
        p.descripcion
      FROM outfits o
      LEFT JOIN outfit_items oi ON oi.outfit_id = o.id
      LEFT JOIN posts p ON p.id = oi.post_id
      WHERE o.usuario_id = ?
      ORDER BY o.created_at DESC, oi.slot ASC
      `,
      [id]
    );

    const byOutfit = new Map();

    rows.forEach((row) => {
      if (!byOutfit.has(row.id)) {
        byOutfit.set(row.id, {
          id: row.id,
          nombre: row.nombre,
          created_at: row.created_at,
          prendas: []
        });
      }

      if (row.post_id) {
        byOutfit.get(row.id).prendas.push({
          slot: row.slot,
          post_id: row.post_id,
          descripcion: row.descripcion
        });
      }
    });

    const outfits = Array.from(byOutfit.values())
      .map((outfit) => ({
        ...outfit,
        prendas: outfit.prendas.sort((a, b) => a.slot - b.slot)
      }))
      .filter((outfit) => outfit.prendas.length === 4);

    res.json({ success: true, outfits });
  } catch (error) {
    console.error('Error al obtener outfits:', error);
    res.status(500).json({ error: 'Error al obtener outfits' });
  }
});

// Buscar usuarios
app.get('/users/search', async (req, res) => {
  const { q } = req.query;
  console.log('Búsqueda de usuarios:', q);
  
  if (!q || q.trim().length < 1) {
    return res.status(400).json({ error: 'La búsqueda debe tener al menos 1 caracter' });
  }
  
  try {
    const [users] = await pool.query(
      'SELECT id, username, email FROM usuarios WHERE LOWER(username) LIKE LOWER(?) OR LOWER(email) LIKE LOWER(?) LIMIT 20',
      [`%${q}%`, `%${q}%`]
    );
    console.log('Usuarios encontrados:', users.length);
    
    res.json({ success: true, users });
  } catch (error) {
    console.error('Error al buscar usuarios:', error);
    res.status(500).json({ error: 'Error al buscar usuarios' });
  }
});

// Seguir a un usuario
app.post('/users/follow/:userId', authenticateToken, async (req, res) => {
  const { userId } = req.params;
  const followerId = req.user.id;
  
  if (parseInt(userId) === followerId) {
    return res.status(400).json({ error: 'No puedes seguirte a ti mismo' });
  }
  
  try {
    await pool.query(
      'INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)',
      [followerId, userId]
    );
    
    res.json({ success: true, message: 'Usuario seguido' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'Ya sigues a este usuario' });
    } else {
      console.error('Error al seguir usuario:', error);
      res.status(500).json({ error: 'Error al seguir usuario' });
    }
  }
});

// Dejar de seguir a un usuario
app.delete('/users/follow/:userId', authenticateToken, async (req, res) => {
  const { userId } = req.params;
  const followerId = req.user.id;
  
  try {
    await pool.query(
      'DELETE FROM follows WHERE follower_id = ? AND followed_id = ?',
      [followerId, userId]
    );
    
    res.json({ success: true, message: 'Usuario dejado de seguir' });
  } catch (error) {
    console.error('Error al dejar de seguir usuario:', error);
    res.status(500).json({ error: 'Error al dejar de seguir usuario' });
  }
});

// Obtener usuarios que sigo
app.get('/users/following', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  
  try {
    const [users] = await pool.query(`
      SELECT u.id, u.username, u.email
      FROM follows f
      INNER JOIN usuarios u ON f.followed_id = u.id
      WHERE f.follower_id = ?
      ORDER BY f.created_at DESC
    `, [userId]);
    
    res.json({ success: true, users });
  } catch (error) {
    console.error('Error al obtener usuarios seguidos:', error);
    res.status(500).json({ error: 'Error al obtener usuarios seguidos' });
  }
});

// Obtener seguidores
app.get('/users/followers', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  
  try {
    const [users] = await pool.query(`
      SELECT u.id, u.username, u.email
      FROM follows f
      INNER JOIN usuarios u ON f.follower_id = u.id
      WHERE f.followed_id = ?
      ORDER BY f.created_at DESC
    `, [userId]);
    
    res.json({ success: true, users });
  } catch (error) {
    console.error('Error al obtener seguidores:', error);
    res.status(500).json({ error: 'Error al obtener seguidores' });
  }
});

app.post('/outfits', authenticateToken, async (req, res) => {
  const usuario_id = req.user.id;
  const { nombre, post_ids } = req.body;

  if (!Array.isArray(post_ids)) {
    return res.status(400).json({ error: 'post_ids es obligatorio' });
  }

  const cleanPostIds = [...new Set(post_ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (cleanPostIds.length !== 4) {
    return res.status(400).json({ error: 'Debes seleccionar exactamente 4 prendas distintas' });
  }

  const placeholders = cleanPostIds.map(() => '?').join(',');

  let connection;
  try {
    const [ownedPosts] = await pool.query(
      `SELECT id FROM posts WHERE usuario_id = ? AND id IN (${placeholders})`,
      [usuario_id, ...cleanPostIds]
    );

    if (ownedPosts.length !== 4) {
      return res.status(400).json({ error: 'Solo puedes crear outfits con prendas de tu armario' });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [outfitResult] = await connection.query(
      'INSERT INTO outfits (usuario_id, nombre) VALUES (?, ?)',
      [usuario_id, (nombre || '').trim() || null]
    );

    const outfitId = outfitResult.insertId;

    for (let i = 0; i < cleanPostIds.length; i++) {
      await connection.query(
        'INSERT INTO outfit_items (outfit_id, post_id, slot) VALUES (?, ?, ?)',
        [outfitId, cleanPostIds[i], i + 1]
      );
    }

    await connection.commit();

    res.json({
      success: true,
      message: 'Outfit creado correctamente',
      outfitId
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('Error al crear outfit:', error);
    res.status(500).json({ error: 'Error al crear outfit' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

app.delete('/outfits/:outfitId', authenticateToken, async (req, res) => {
  const { outfitId } = req.params;
  const usuario_id = req.user.id;

  try {
    const [result] = await pool.query(
      'DELETE FROM outfits WHERE id = ? AND usuario_id = ?',
      [outfitId, usuario_id]
    );

    if (result.affectedRows === 0) {
      return res.status(403).json({ error: 'No autorizado o el outfit no existe' });
    }

    res.json({ success: true, message: 'Outfit borrado correctamente' });
  } catch (error) {
    console.error('Error al borrar outfit:', error);
    res.status(500).json({ error: 'Error al borrar outfit' });
  }
});

app.post('/outfits/ia-generate', authenticateToken, async (req, res) => {
  const usuario_id = req.user.id;
  const { prompt } = req.body;

  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({ error: 'El prompt es obligatorio para generar outfit con IA' });
  }

  const webhookUrl = process.env.N8N_OUTFIT_WEBHOOK_URL || DEFAULT_N8N_OUTFIT_WEBHOOK_URL;
  if (!webhookUrl) {
    return res.status(500).json({ error: 'Webhook de outfit IA no configurado (N8N_OUTFIT_WEBHOOK_URL)' });
  }

  try {
    const [wardrobeRows] = await pool.query(
      `
      SELECT id, descripcion, descripcion_prenda, created_at
      FROM posts
      WHERE usuario_id = ?
      ORDER BY created_at DESC
      LIMIT 80
      `,
      [usuario_id]
    );

    if (wardrobeRows.length < 4) {
      return res.status(400).json({ error: 'Necesitas al menos 4 prendas en tu armario para generar un outfit' });
    }

    const webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        usuario_id,
        prompt: String(prompt).trim(),
        wardrobe_items: wardrobeRows.map((row) => ({
          post_id: row.id,
          pie_foto: row.descripcion || '',
          descripcion_prenda: row.descripcion_prenda || '',
          created_at: row.created_at
        }))
      })
    });

    const rawResponse = await webhookResponse.text();
    let parsedResponse = {};
    try {
      parsedResponse = rawResponse ? JSON.parse(rawResponse) : {};
    } catch {
      parsedResponse = {};
    }

    if (!webhookResponse.ok) {
      return res.status(502).json({
        error: 'Error al solicitar outfit IA en n8n',
        n8n_status: webhookResponse.status,
        n8n_response: rawResponse
      });
    }

    const responseIds = parsedResponse.post_ids
      ?? parsedResponse.selected_post_ids
      ?? parsedResponse.postIds
      ?? parsedResponse.ids
      ?? [];

    const cleanPostIds = [...new Set(
      (Array.isArray(responseIds) ? responseIds : [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )];

    if (cleanPostIds.length !== 4) {
      return res.status(422).json({
        error: 'La IA no devolvio exactamente 4 post_ids validos',
        n8n_response: rawResponse
      });
    }

    const placeholders = cleanPostIds.map(() => '?').join(',');
    const [ownedPosts] = await pool.query(
      `SELECT id FROM posts WHERE usuario_id = ? AND id IN (${placeholders})`,
      [usuario_id, ...cleanPostIds]
    );

    if (ownedPosts.length !== 4) {
      return res.status(400).json({ error: 'La IA selecciono prendas fuera de tu armario' });
    }

    const nombreSugerido = String(
      parsedResponse.nombre
      ?? parsedResponse.nombre_outfit
      ?? parsedResponse.outfit_name
      ?? `Outfit IA: ${String(prompt).trim().slice(0, 60)}`
    ).trim().slice(0, 120);

    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      const [outfitResult] = await connection.query(
        'INSERT INTO outfits (usuario_id, nombre) VALUES (?, ?)',
        [usuario_id, nombreSugerido || null]
      );

      const outfitId = outfitResult.insertId;

      for (let i = 0; i < cleanPostIds.length; i++) {
        await connection.query(
          'INSERT INTO outfit_items (outfit_id, post_id, slot) VALUES (?, ?, ?)',
          [outfitId, cleanPostIds[i], i + 1]
        );
      }

      await connection.commit();

      res.json({
        success: true,
        message: 'Outfit IA generado correctamente',
        outfitId,
        post_ids: cleanPostIds,
        nombre: nombreSugerido,
        descripcion: String(
          parsedResponse.descripcion
          ?? parsedResponse.explicacion
          ?? parsedResponse.reasoning
          ?? parsedResponse.texto
          ?? ''
        ).trim()
      });
    } catch (error) {
      if (connection) {
        await connection.rollback();
      }
      throw error;
    } finally {
      if (connection) {
        connection.release();
      }
    }
  } catch (error) {
    console.error('Error al generar outfit IA:', error);
    res.status(500).json({ error: 'Error al generar outfit IA' });
  }
});

app.post('/outfits/:outfitId/try-on', authenticateToken, async (req, res) => {
  const { outfitId } = req.params;
  const usuario_id = req.user.id;
  const { foto_usuario } = req.body;

  if (!foto_usuario || !String(foto_usuario).trim()) {
    return res.status(400).json({ error: 'Debes subir una foto de cuerpo entero para probar el outfit' });
  }

  const webhookUrl = process.env.N8N_OUTFIT_TRYON_WEBHOOK_URL || DEFAULT_N8N_OUTFIT_TRYON_WEBHOOK_URL;
  if (!webhookUrl) {
    return res.status(500).json({ error: 'Webhook de try-on no configurado (N8N_OUTFIT_TRYON_WEBHOOK_URL)' });
  }

  try {
    const [rows] = await pool.query(
      `
      SELECT
        o.id as outfit_id,
        o.nombre as outfit_nombre,
        oi.slot,
        p.id as post_id,
        p.foto,
        p.descripcion,
        p.descripcion_prenda
      FROM outfits o
      INNER JOIN outfit_items oi ON oi.outfit_id = o.id
      INNER JOIN posts p ON p.id = oi.post_id
      WHERE o.id = ? AND o.usuario_id = ?
      ORDER BY oi.slot ASC
      `,
      [outfitId, usuario_id]
    );

    if (rows.length !== 4) {
      return res.status(404).json({ error: 'Outfit no encontrado o incompleto para este usuario' });
    }

    const webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        usuario_id,
        outfit_id: Number(outfitId),
        outfit_nombre: rows[0].outfit_nombre || '',
        foto_usuario_base64: String(foto_usuario),
        outfit_items: rows.map((row) => ({
          slot: row.slot,
          post_id: row.post_id,
          foto_prenda_base64: row.foto || '',
          pie_foto: row.descripcion || '',
          descripcion_prenda: row.descripcion_prenda || ''
        }))
      })
    });

    const rawResponse = await webhookResponse.text();
    let parsedResponse = {};
    try {
      parsedResponse = rawResponse ? JSON.parse(rawResponse) : {};
    } catch {
      parsedResponse = {};
    }

    if (!webhookResponse.ok) {
      return res.status(502).json({
        error: 'Error al generar prueba de outfit en n8n',
        n8n_status: webhookResponse.status,
        n8n_response: rawResponse
      });
    }

    const resultImage = String(
      parsedResponse.result_image_base64
      ?? parsedResponse.imagen_resultado
      ?? parsedResponse.output_image_base64
      ?? parsedResponse.image_base64
      ?? parsedResponse.image
      ?? ''
    ).trim();

    if (!resultImage) {
      return res.status(422).json({
        error: 'n8n no devolvio una imagen de resultado',
        n8n_response: rawResponse
      });
    }

    const normalizedImage = resultImage.startsWith('data:')
      ? resultImage
      : `data:image/png;base64,${resultImage}`;

    res.json({
      success: true,
      imagen_resultado: normalizedImage,
      descripcion: String(
        parsedResponse.descripcion
        ?? parsedResponse.explicacion
        ?? parsedResponse.texto
        ?? 'Previsualizacion de outfit generada correctamente.'
      ).trim()
    });
  } catch (error) {
    console.error('Error al probar outfit:', error);
    res.status(500).json({ error: 'Error al probar outfit con IA' });
  }
});

app.post('/posts/:postId/ia-description', authenticateToken, async (req, res) => {
  const { postId } = req.params;
  const usuario_id = req.user.id;

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

app.post('/posts/:postId/match', authenticateToken, async (req, res) => {
  const { postId } = req.params;
  const usuario_id = req.user.id;

  const webhookUrl = process.env.N8N_POST_MATCH_WEBHOOK_URL || DEFAULT_N8N_POST_MATCH_WEBHOOK_URL;
  if (!webhookUrl) {
    return res.status(500).json({ error: 'Webhook de match no configurado (N8N_POST_MATCH_WEBHOOK_URL)' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, usuario_id, descripcion, descripcion_prenda, foto FROM posts WHERE id = ? LIMIT 1',
      [postId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Post no encontrado' });
    }

    const post = rows[0];

    const webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        post_id: post.id,
        usuario_id_click: Number(usuario_id),
        usuario_id_propietario_post: post.usuario_id,
        pie_foto: post.descripcion || '',
        descripcion_prenda: post.descripcion_prenda || '',
        foto_base64: post.foto || ''
      })
    });

    const rawResponse = await webhookResponse.text();
    let parsedResponse = {};
    try {
      parsedResponse = rawResponse ? JSON.parse(rawResponse) : {};
    } catch {
      parsedResponse = {};
    }

    if (!webhookResponse.ok) {
      return res.status(502).json({
        error: 'Error al solicitar match en n8n',
        n8n_status: webhookResponse.status,
        n8n_response: rawResponse
      });
    }

    const maybePercentage = Number(
      parsedResponse.porcentaje ??
      parsedResponse.match_percentage ??
      parsedResponse.score ??
      parsedResponse.puntuacion
    );

    const percentageFromText = rawResponse.match(/(\d{1,3})(?:\s?%)/);
    const porcentaje = Number.isFinite(maybePercentage)
      ? Math.max(0, Math.min(100, Math.round(maybePercentage)))
      : percentageFromText
        ? Math.max(0, Math.min(100, Number(percentageFromText[1])))
        : 0;

    const descripcion = String(
      parsedResponse.descripcion ??
      parsedResponse.description ??
      parsedResponse.texto ??
      parsedResponse.explicacion ??
      rawResponse ??
      ''
    ).trim();

    res.json({
      success: true,
      porcentaje,
      descripcion: descripcion || 'No se recibio descripcion del match.'
    });
  } catch (error) {
    console.error('Error al solicitar match IA:', error);
    res.status(500).json({ error: 'Error al solicitar match IA' });
  }
});


app.get('/posts/:postId/photo', async (req, res) => {
  const { postId } = req.params;
  
  try {
    const [rows] = await pool.query(
      'SELECT foto FROM posts WHERE id = ? LIMIT 1',
      [postId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Post no encontrado' });
    }
    
    res.json({ success: true, foto: rows[0].foto });
  } catch (error) {
    console.error('Error al obtener foto:', error);
    res.status(500).json({ error: 'Error al obtener foto' });
  }
});

app.delete('/posts/:postId', authenticateToken, async (req, res) => {
  const { postId } = req.params;
  const usuario_id = req.user.id;
  
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
app.post('/noticias', authenticateToken, async (req, res) => {
  const usuario_id = req.user.id;
  const { titulo, texto, imagen } = req.body;

  if (!titulo || !texto) {
    return res.status(400).json({ error: 'Título y texto son obligatorios' });
  }

  try {
    const fuente = 'usuario';
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
app.delete('/noticias/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const usuario_id = req.user.id;

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
app.post('/noticias/:id/like', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const usuario_id = req.user.id;

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
app.delete('/noticias/:id/like', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const usuario_id = req.user.id;

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
app.post('/noticias/:id/comments', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const usuario_id = req.user.id;
  const { texto } = req.body;

  if (!texto) {
    return res.status(400).json({ error: 'Texto es obligatorio' });
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
