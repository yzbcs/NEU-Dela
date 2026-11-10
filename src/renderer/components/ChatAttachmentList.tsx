import { FileText, Image, Paperclip, X } from 'lucide-react';
import type { ChatAttachment } from '../../shared/types';
import './chat-attachments.css';

export function ChatAttachmentList({
  files,
  onOpen,
  onRemove,
  disabled = false,
}: {
  files: ChatAttachment[];
  onOpen: (file: ChatAttachment) => void;
  onRemove?: (file: ChatAttachment) => void;
  disabled?: boolean;
}) {
  if (!files.length) return null;
  return (
    <div className="chat-attachment-list" aria-label="引用文件">
      {files.map((file) => {
        const Icon = file.kind === 'image' ? Image : file.kind === 'pdf' ? FileText : Paperclip;
        return (
          <div className="chat-attachment" key={file.id} data-attachment-id={file.id}>
            <button type="button" className="chat-attachment-open" onClick={() => onOpen(file)}>
              <Icon size={16} />
              <span>
                {file.name}
                <small>{Math.max(1, Math.ceil(file.size / 1024))} KB</small>
              </span>
            </button>
            {onRemove && (
              <button
                type="button"
                className="chat-attachment-remove"
                aria-label={'移除引用文件 ' + file.name}
                disabled={disabled}
                onClick={() => onRemove(file)}
              >
                <X size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
