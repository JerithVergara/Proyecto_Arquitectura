# Mesa de ayuda - SaaS de Tickets y Tareas

Sistema web con login, tickets (con comentarios) y tareas personales.
Desarrollado con Node.js, Express y MongoDB Atlas (Mongoose).

## Modelos
- Usuario, Ticket, Tarea, Mensaje (chat global y privado)

## Endpoints principales
- POST /api/registro, POST /api/login
- GET, POST, PUT, DELETE /api/tickets
- POST /api/tickets/:id/comentarios
- GET, POST, PUT, DELETE /api/tareas
- GET /api/usuarios, GET/POST /api/mensajes (chat)

## Variables de entorno
- MONGO_URI: cadena de conexion de MongoDB Atlas
- JWT_SECRET: frase secreta para firmar las sesiones

## Ejecutar
npm install
npm start
