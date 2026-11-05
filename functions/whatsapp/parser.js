export function getIncomingMessageData(message) {
  if (!message) return null;

  if (message.type === "text") {
    return {
      kind: "text",
      text: message.text?.body || "",
      selectionId: null,
    };
  }

  if (message.type === "interactive") {
    const listReply = message.interactive?.list_reply;
    if (listReply?.id) {
      return {
        kind: "interactive_list",
        text: listReply.title || "",
        selectionId: listReply.id,
      };
    }

    const buttonReply = message.interactive?.button_reply;
    if (buttonReply?.id) {
      return {
        kind: "interactive_button",
        text: buttonReply.title || "",
        selectionId: buttonReply.id,
      };
    }
  }

  if (message.type === "button" && message.button?.payload) {
    return {
      kind: "button",
      text: message.button?.text || "",
      selectionId: message.button.payload,
    };
  }

  return {
    kind: message.type || "unknown",
    text: "",
    selectionId: null,
  };
}
