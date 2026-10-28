import { generateToWorkspace } from "./m365-image-workspace.mjs";

export default {
  id: "m365-workspace-images",
  async setup(context) {
    const registration = await context.tool.transform(editor => {
      editor.add({
        name: "m365_generate_image",
        description: [
          "Generate a real image with M365 and save the PNG in the current workspace.",
          "The user cannot upload or view images in chat: everything goes through workspace files.",
          "Do not ask for attachments or promise to display images here; return the path so it can be opened outside the chat.",
          "Only creates images from text; no visual references or image editing.",
          "Use this tool to create images instead of generating remote links in chat.",
          "Provide a prompt, a relative .png path, and optionally orientation.",
          "Does not overwrite existing files. Returns only path, dimensions, and size:",
          "Never returns base64 or image URLs to the conversation history.",
          "After execution, report the real returned path. Do not invent sandbox links.",
        ].join(" "),
        input: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "Full image description." },
            path: { type: "string", description: "New relative path, e.g. generated-images/landscape.png." },
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
            metadata: { title: "Image saved: " + result.path },
          };
        },
      });
    });
    return () => registration.dispose();
  },
};
