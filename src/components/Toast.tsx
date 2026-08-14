import { useEffect } from "react";
import "./Toast.css";
export interface ToastMessage {
  id: string;
  message: string;
  type: "success" | "error" | "warning" | "info";
  duration?: number;
}

interface ToastProps {
  messages: ToastMessage[];
  onRemove: (id: string) => void;
}

function Toast({ messages, onRemove }: ToastProps) {
  return (
    <div className="toast-container">
      {messages.map((msg) => (
        <ToastItem key={msg.id} message={msg} onRemove={onRemove} />
      ))}
    </div>
  );
}

function ToastItem({
  message,
  onRemove,
}: {
  message: ToastMessage;
  onRemove: (id: string) => void;
}) {
  useEffect(() => {
    const duration = message.duration || 3000;
    const timer = setTimeout(() => {
      onRemove(message.id);
    }, duration);

    return () => clearTimeout(timer);
  }, [message, onRemove]);

  const getIcon = () => {
    switch (message.type) {
      case "success":
        return "✓";
      case "error":
        return "✗";
      case "warning":
        return "⚠";
      case "info":
        return "ℹ";
    }
  };

  return (
    <div className={`toast toast-${message.type}`}>
      <span className="toast-icon">{getIcon()}</span>
      <span className="toast-message">{message.message}</span>
      <button className="toast-close" onClick={() => onRemove(message.id)}>
        ×
      </button>
    </div>
  );
}

export default Toast;
