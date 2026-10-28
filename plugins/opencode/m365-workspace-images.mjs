import { generateToWorkspace } from "./m365-image-workspace.mjs";

export default {
  id: "m365-workspace-images",
  async setup(context) {
    const registration = await context.tool.transform(editor => {
      editor.add({
        name: "m365_generate_image",
        description: [
          "Genera una imagen real con M365 y guarda el PNG en el workspace actual.",
          "El usuario no puede subir ni ver imagenes en el chat: todo pasa por archivos del workspace.",
          "No pidas adjuntos ni prometas mostrar imagenes aqui; devuelve la ruta para abrirla fuera del chat.",
          "Solo crea imagenes desde texto; no admite referencias visuales ni edicion de imagenes existentes.",
          "Usa esta herramienta para crear imagenes, en lugar de generar enlaces remotos en el chat.",
          "Indica prompt, una ruta relativa .png y opcionalmente orientation.",
          "No sobrescribe archivos existentes. Devuelve solo ruta, dimensiones y tamano:",
          "nunca devuelve base64 ni URLs de imagen al historial.",
          "Tras ejecutarla, informa de la ruta real devuelta. No inventes enlaces sandbox.",
        ].join(" "),
        input: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "Descripcion completa de la imagen." },
            path: { type: "string", description: "Ruta relativa nueva, por ejemplo generated-images/paisaje.png." },
            orientation: { type: "string", enum: ["square", "landscape", "portrait"] },
          },
          required: ["prompt", "path"],
          additionalProperties: false,
        },
        async execute(input, execution) {
          const result = await generateToWorkspace(
            input, context.location.directory, execution.signal,
          );
          return {
            content: JSON.stringify(result),
            metadata: { title: "Imagen guardada: " + result.path },
          };
        },
      });
    });
    return () => registration.dispose();
  },
};
