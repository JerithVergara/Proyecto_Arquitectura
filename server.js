const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());
// Solo se sirve la carpeta public (server.js y package.json quedan privados)
app.use(express.static(path.join(__dirname, "public")));

const JWT_SECRET = process.env.JWT_SECRET || "cambia_esta_clave";

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Conectado a MongoDB"))
  .catch((err) => console.log("❌ Error MongoDB:", err.message));

// ---------- MODELOS ----------
const Usuario = mongoose.model(
  "Usuario",
  new mongoose.Schema({
    username: { type: String, unique: true, required: true, trim: true },
    password: { type: String, required: true },
  })
);

const Ticket = mongoose.model(
  "Ticket",
  new mongoose.Schema({
    titulo: { type: String, required: true, trim: true },
    descripcion: { type: String, default: "" },
    prioridad: { type: String, enum: ["baja", "media", "alta"], default: "media" },
    estado: { type: String, enum: ["abierto", "en_proceso", "cerrado"], default: "abierto" },
    creador: { type: String, required: true },
    comentarios: [{ autor: String, texto: String, fecha: { type: Date, default: Date.now } }],
    fecha: { type: Date, default: Date.now },
  })
);

const Tarea = mongoose.model(
  "Tarea",
  new mongoose.Schema({
    titulo: { type: String, required: true, trim: true },
    completada: { type: Boolean, default: false },
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: "Ticket", default: null },
    creador: { type: String, required: true },
    fecha: { type: Date, default: Date.now },
  })
);

const Mensaje = mongoose.model(
  "Mensaje",
  new mongoose.Schema({
    de: { type: String, required: true },
    para: { type: String, default: null }, // null = chat global
    mensaje: { type: String, required: true },
    fecha: { type: Date, default: Date.now },
  })
);

// ---------- AUTENTICACIÓN ----------
function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  try {
    req.user = jwt.verify(token, JWT_SECRET).username;
    next();
  } catch {
    res.status(401).json({ error: "Sesión inválida, inicia sesión de nuevo" });
  }
}

app.post("/api/registro", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || password.length < 4)
      return res.status(400).json({ error: "Usuario y contraseña (mín. 4 caracteres) son obligatorios" });
    await Usuario.create({ username, password: await bcrypt.hash(password, 10) });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.code === 11000 ? 409 : 500).json({ error: e.code === 11000 ? "Ese usuario ya existe" : "Error al registrar" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await Usuario.findOne({ username });
  if (!user || !(await bcrypt.compare(password || "", user.password)))
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, username });
});

// ---------- TICKETS ----------
app.get("/api/tickets", auth, async (req, res) => {
  res.json(await Ticket.find().sort({ fecha: -1 }));
});

app.post("/api/tickets", auth, async (req, res) => {
  const { titulo, descripcion, prioridad } = req.body;
  if (!titulo) return res.status(400).json({ error: "El título es obligatorio" });
  res.json(await Ticket.create({ titulo, descripcion, prioridad, creador: req.user }));
});

app.put("/api/tickets/:id", auth, async (req, res) => {
  const { estado, prioridad } = req.body;
  const t = await Ticket.findByIdAndUpdate(req.params.id, { estado, prioridad }, { new: true, runValidators: true });
  t ? res.json(t) : res.status(404).json({ error: "Ticket no encontrado" });
});

app.delete("/api/tickets/:id", auth, async (req, res) => {
  const t = await Ticket.findOneAndDelete({ _id: req.params.id, creador: req.user });
  if (!t) return res.status(403).json({ error: "Solo quien creó el ticket puede eliminarlo" });
  await Tarea.updateMany({ ticket: t._id }, { ticket: null });
  res.json({ ok: true });
});

// Comentarios (reemplazan al chat original)
app.post("/api/tickets/:id/comentarios", auth, async (req, res) => {
  if (!req.body.texto) return res.status(400).json({ error: "El comentario está vacío" });
  const t = await Ticket.findByIdAndUpdate(
    req.params.id,
    { $push: { comentarios: { autor: req.user, texto: req.body.texto } } },
    { new: true }
  );
  t ? res.json(t) : res.status(404).json({ error: "Ticket no encontrado" });
});

// ---------- TAREAS ----------
app.get("/api/tareas", auth, async (req, res) => {
  res.json(await Tarea.find({ creador: req.user }).populate("ticket", "titulo").sort({ fecha: -1 }));
});

app.post("/api/tareas", auth, async (req, res) => {
  const { titulo, ticket } = req.body;
  if (!titulo) return res.status(400).json({ error: "El título es obligatorio" });
  res.json(await Tarea.create({ titulo, ticket: ticket || null, creador: req.user }));
});

app.put("/api/tareas/:id", auth, async (req, res) => {
  const t = await Tarea.findOneAndUpdate({ _id: req.params.id, creador: req.user }, { completada: req.body.completada }, { new: true });
  t ? res.json(t) : res.status(404).json({ error: "Tarea no encontrada" });
});

app.delete("/api/tareas/:id", auth, async (req, res) => {
  await Tarea.findOneAndDelete({ _id: req.params.id, creador: req.user });
  res.json({ ok: true });
});

// ---------- CHAT (global + privado) ----------
app.get("/api/usuarios", auth, async (req, res) => {
  res.json(await Usuario.find({}, "username"));
});

app.get("/api/mensajes", auth, async (req, res) => {
  const con = req.query.con;
  const filtro = con
    ? { $or: [{ de: req.user, para: con }, { de: con, para: req.user }] }
    : { para: null };
  const m = await Mensaje.find(filtro).sort({ fecha: -1 }).limit(100);
  res.json(m.reverse());
});

app.post("/api/mensajes", auth, async (req, res) => {
  const { para, mensaje } = req.body;
  if (!mensaje || !mensaje.trim()) return res.status(400).json({ error: "El mensaje está vacío" });
  res.json(await Mensaje.create({ de: req.user, para: para || null, mensaje: mensaje.trim() }));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Servidor en puerto " + port));
