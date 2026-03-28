const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const officeParser = require("officeparser");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get("/test-db", async (req, res) => {
  const { data, error } = await supabase.from("canciones").select("*");

  if (error) return res.json(error);

  res.json(data);
});
// 🔐 CONTRASEÑA ADMIN
const PASSWORD = "1234"; // 🔥 cámbiala


// 📁 crear carpeta uploads si no existe
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}


// 📁 almacenamiento archivos
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    const ext = file.originalname.split(".").pop();
    const nombre = Date.now() + "_" + Math.floor(Math.random()*1000) + "." + ext;
    cb(null, nombre);
  }
});

const upload = multer({ storage });


// 🔥 base de datos persistente
let cancionesDB = [];

if (fs.existsSync("canciones.json")) {
  cancionesDB = JSON.parse(fs.readFileSync("canciones.json"));
}

function guardarDB() {
  fs.writeFileSync("canciones.json", JSON.stringify(cancionesDB, null, 2));
}


// 🔍 NORMALIZAR TEXTO (🔥 CLAVE)
function normalizar(texto) {
  return texto
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}


// 🔍 buscar por nombre
function encontrarIndicePorTitulo(titulo) {
  if (!titulo) return -1;

  const clave = normalizar(titulo);

  return cancionesDB.findIndex(c =>
    normalizar(c.titulo) === clave
  );
}


// 🔁 lógica add/replace
function processCancionEnDB(cancion, replaceExisting) {
  const idx = encontrarIndicePorTitulo(cancion.titulo);

  if (idx !== -1) {
    if (replaceExisting) {
      cancionesDB[idx] = cancion;
      return "replaced";
    } else {
      return "skipped";
    }
  } else {
    cancionesDB.push(cancion);
    return "added";
  }
}


// 🔥 dividir texto (PDF)
function dividirEnSlides(texto) {
  let lineas = texto.split("\n").filter(l => l.trim() !== "");

  let slides = [];
  let slideActual = [];

  lineas.forEach(linea => {
    slideActual.push(linea);

    if (slideActual.length === 4) {
      slides.push(slideActual.join("\n"));
      slideActual = [];
    }
  });

  if (slideActual.length > 0) {
    slides.push(slideActual.join("\n"));
  }

  return slides;
}


// 🔥 procesar archivo
async function procesarArchivo(file) {

  const filePath = file.path;
  const nombreArchivo = file.originalname;

  let slides = [];

  try {

    // 📄 PDF
    if (nombreArchivo.endsWith(".pdf")) {

      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);

      if (!data.text) return null;

      slides = dividirEnSlides(data.text);
    }

    // 📊 PPTX
    else if (nombreArchivo.endsWith(".pptx")) {

      let resultado;

      try {
        resultado = await officeParser.parseOffice(filePath);
      } catch (err) {
        console.log("⚠️ Archivo inválido:", nombreArchivo);
        return null;
      }

      if (resultado && resultado.content) {

        resultado.content.forEach(slide => {

          let textoSlide = "";

          slide.children?.forEach(parrafo => {
            if (parrafo.text && typeof parrafo.text === "string") {
              textoSlide += parrafo.text.trim() + "\n";
            }
          });

          if (textoSlide.trim()) {
            slides.push(textoSlide.trim());
          }

        });
      }

      if (slides.length === 0) return null;
    }

    else {
      return null;
    }

    return {
      id: Date.now() + Math.random(),
      titulo: nombreArchivo,
      slides: slides
    };

  } catch (error) {
    console.log("❌ Error procesando:", nombreArchivo);
    return null;
  }
}


//
// 🚀 SUBIR ARCHIVOS
//
app.post("/upload", upload.array("archivo", 20), async (req, res) => {
  try {

    if (req.body.password !== PASSWORD) {
      return res.status(403).json({ error: "Acceso denegado" });
    }

    const replaceExisting = req.body.replace === "true";

    const added = [];
    const replaced = [];
    const skipped = [];
    const errors = [];

    for (let file of req.files) {

      let cancion = await procesarArchivo(file);

      if (cancion) {
        const resultado = processCancionEnDB(cancion, replaceExisting);

        if (resultado === "added") added.push(cancion.titulo);
        else if (resultado === "replaced") replaced.push(cancion.titulo);
        else skipped.push(cancion.titulo);

      } else {
        errors.push(file.originalname);
      }

      fs.unlinkSync(file.path);
    }

    guardarDB();

    res.json({ added, replaced, skipped, errors });

  } catch (error) {
    res.status(500).json({ error: "Error en subida" });
  }
});


//
// 🚀 CARGA MASIVA
//
app.post("/upload-multiple", upload.array("archivo", 200), async (req, res) => {
  try {

    if (req.body.password !== PASSWORD) {
      return res.status(403).json({ error: "Acceso denegado" });
    }

    const replaceExisting = req.body.replace === "true";

    const added = [];
    const replaced = [];
    const skipped = [];
    const errors = [];

    for (let file of req.files) {

      let cancion = await procesarArchivo(file);

      if (cancion) {
        const resultado = processCancionEnDB(cancion, replaceExisting);

        if (resultado === "added") added.push(cancion.titulo);
        else if (resultado === "replaced") replaced.push(cancion.titulo);
        else skipped.push(cancion.titulo);

      } else {
        errors.push(file.originalname);
      }

      fs.unlinkSync(file.path);
    }

    guardarDB();

    res.json({ added, replaced, skipped, errors });

  } catch (error) {
    res.status(500).json({ error: "Error en carga masiva" });
  }
});


//
// 🗑️ ELIMINAR (🔥 FIX IMPORTANTE)
//
app.delete("/eliminar/:id", (req, res) => {

  const password = req.body.password || req.headers["password"];

  if (password !== PASSWORD) {
    return res.status(403).json({ error: "Acceso denegado" });
  }

  const id = parseFloat(req.params.id);

  const index = cancionesDB.findIndex(c => c.id == id);

  if (index === -1) {
    return res.status(404).json({ error: "No encontrada" });
  }

  const eliminada = cancionesDB.splice(index, 1);

  guardarDB();

  res.json({ eliminada });
});


//
// 📥 obtener canciones
//
app.get("/canciones", (req, res) => {
  res.json(cancionesDB);
});


//
// 🚀 iniciar servidor
//
const PORT = process.env.PORT || 3000;
app.get("/test-db", (req, res) => {
  res.json({ mensaje: "Servidor funcionando correctamente 🚀" });
});
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});