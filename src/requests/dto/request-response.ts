import { DocumentRequest } from '../entities/document-request.entity';

export function toRequestResponse(request: DocumentRequest | null) {
  if (!request) {
    return null;
  }

  return {
    id: request.id,
    title: request.title,
    description: request.description,
    status: request.status,
    rejectionReason: request.rejectionReason ?? null,
    dueDate: request.dueDate ?? null,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    reviewedAt: request.reviewedAt ?? null,
    version: request.version,
    file: request.storageKey
      ? {
          originalName: request.originalName,
          mimeType: request.mimeType,
          fileSize: request.fileSize,
        }
      : null,
  };
}
