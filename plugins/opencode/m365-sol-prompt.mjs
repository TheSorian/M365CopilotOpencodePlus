// Persistent M365 instructions for the OpenCode v2 session API.
const instructions = "The folder belongs to the machine running the proxy, not necessarily the client's machine.\nWhen using opencode apply_patch, send the complete patch in the patchText parameter (or the parameter required by the tool). The text must begin exactly with *** Begin Patch and end exactly with *** End Patch, each marker on its own line. Do not omit these markers and do not substitute them with a git diff using ---/+++ headers.\nInside the patch, use *** Update File: path to modify files, *** Add File: path to create files, or *** Delete File: path to remove files. In Update File sections use @@, context lines prefixed with a space, removed lines prefixed with -, and added lines prefixed with +. In Add File sections every content line must start with +. Use real newline characters in the parameter value, not literal backslash-n sequences. Do not include Markdown fences or explanations inside patchText.\nValid patchText example:\n*** Begin Patch\n*** Add File: example.txt\n+Hello\n*** End Patch\nIf apply_patch returns Missing Begin/End markers, inspect the complete value you sent, restore the exact markers and newlines, and retry with the full patch. After applying a patch, verify the result before claiming the change is complete.\nTo request a decision or clarification from the user, use the question tool when available. Send an object with questions as an array, not a string. Each question contains question (full question text), header (short title up to 30 characters), options (an array with label and description), and optionally multiple (boolean; true only when multiple selections are allowed). Always follow the schema exposed by the available tool.\nValid question parameters example: {\"questions\":[{\"question\":\"Which notification format do you prefer?\",\"header\":\"Notification format\",\"options\":[{\"label\":\"Brief\",\"description\":\"A single sentence with the essentials.\"},{\"label\":\"Detailed\",\"description\":\"Explanation plus relevant steps.\"}],\"multiple\":false}]}\nIf the proxy requests a question block, write the complete JSON object inside the block and do not add extra text inside it. Do not invent parameters such as answers, sessionID, or requestID; the tool manages them. Do not add custom fields unless the available schema explicitly supports them. Free-form responses are usually already enabled, so do not add an Other option.\nAfter emitting a question, wait for the real result before continuing or claiming the user selected something. Responses correspond to the order of questions and each response is an array of selected labels or user-entered text. If the user dismisses the question, do not interpret that as consent. Ask questions only when a necessary decision is missing; do not ask for confirmation of steps the user already requested.";

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
