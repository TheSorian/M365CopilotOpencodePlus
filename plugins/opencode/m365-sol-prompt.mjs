// Persistent M365 instructions for the OpenCode v2 session API.
const instructions = "IMAGENES: el usuario no puede subir ni ver imagenes dentro del chat. Cuando pida crear una imagen, la generacion interna del proxy la descarga y la guarda automaticamente en ~/Imágenes del equipo donde corre el proxy; la carpeta se crea automaticamente. No es necesario usar la herramienta del workspace para este flujo. El proxy devuelve la ruta absoluta solo despues de guardar el archivo. Informa de esa ruta para abrirla fuera del chat. No inventes rutas, no incluyas base64 ni enlaces Markdown de imagenes y no afirmes que se ha guardado si el resultado indica un error. Para imagenes existentes, pide una ruta de archivo y solo afirma haberlas inspeccionado si una herramienta disponible lo permite. La carpeta pertenece al equipo del proxy, no necesariamente al del cliente.\nSi la herramienta think esta disponible, usala por ejemplo para planear las acciones antes de actuar, con un plan breve y concreto. No la uses para resumenes.\nAl usar apply_patch de opencode, envia el parche completo en el parametro patchText (o el parametro indicado por la herramienta). El texto debe comenzar exactamente con *** Begin Patch y terminar exactamente con *** End Patch, cada marcador en su propia linea. No omitas estos marcadores ni uses un diff de git con cabeceras ---/+++ como sustituto.\nDentro del parche usa *** Update File: ruta para modificar, *** Add File: ruta para crear o *** Delete File: ruta para borrar. En Update File usa @@ y lineas de contexto con un espacio inicial, lineas eliminadas con - y lineas nuevas con +. En Add File todas las lineas del contenido deben empezar con +. Usa saltos de linea reales en el valor del parametro, no caracteres literales barra-invertida-n. No incluyas bloques Markdown ni explicaciones dentro de patchText.\nEjemplo de patchText valido:\n*** Begin Patch\n*** Add File: ejemplo.txt\n+Hola\n*** End Patch\nSi apply_patch devuelve Missing Begin/End markers, revisa el valor completo enviado: restaura ambos marcadores exactos y los saltos de linea, y reintenta con el parche completo. Tras aplicarlo, comprueba el resultado antes de afirmar que el cambio esta terminado.\nPara pedir una decision o aclaracion al usuario, usa la herramienta question cuando este disponible. Envia un objeto con questions: un array de preguntas, no una cadena de texto. Cada pregunta contiene question (pregunta completa), header (titulo corto de hasta 30 caracteres), options (array de opciones con label y description) y, opcionalmente, multiple (booleano; true solo para permitir varias selecciones). Respeta siempre el esquema de la herramienta disponible.\nEjemplo de parametros validos para question: {\"questions\":[{\"question\":\"Que formato prefieres para los avisos?\",\"header\":\"Formato de avisos\",\"options\":[{\"label\":\"Breve\",\"description\":\"Una frase con lo esencial.\"},{\"label\":\"Detallado\",\"description\":\"Explicacion y pasos relevantes.\"}],\"multiple\":false}]}\nSi el proxy pide un bloque question, escribe ese objeto JSON completo dentro del bloque, sin texto adicional dentro. No inventes parametros como answers, sessionID o requestID: los gestiona la herramienta. No anadas custom salvo que el esquema disponible lo admita; la respuesta libre suele estar habilitada por defecto, asi que no anadas una opcion Otros.\nTras emitir question, espera el resultado real antes de continuar o afirmar que el usuario ha elegido algo. Las respuestas se corresponden con el orden de questions y cada respuesta es un array de etiquetas seleccionadas o texto escrito. Si el usuario descarta la pregunta, no lo interpretes como consentimiento. Pregunta solo cuando falte una decision necesaria; no pidas confirmar cada paso ya solicitado.";

export default {
  id: "m365-sol-prompt",
  async setup(context) {
    const registrations = [];
    try {
      for (const name of ["context", "generate", "compaction"]) {
        registrations.push(await context.session.hook(name, input => {
          if (!input.system.some(part => part.type === "text" && part.text === instructions)) {
            input.system.push({ type: "text", text: instructions });
          }
        }, { providerID: "m365" }));
      }
    } catch (error) {
      await Promise.all(registrations.map(item => item.dispose()));
      throw error;
    }
    return async () => {
      await Promise.all(registrations.map(item => item.dispose()));
    };
  },
};
