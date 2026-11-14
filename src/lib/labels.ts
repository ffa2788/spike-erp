export const QUOTE_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};

export const ORDER_LABEL: Record<string, string> = {
  CONFIRMED: "Ready to ship",
  PARTLY_SHIPPED: "Partly shipped",
  SHIPPED: "Shipped",
  CANCELLED: "Cancelled",
};

export const PO_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Sent to supplier",
  PARTLY_RECEIVED: "Partly received",
  RECEIVED: "Fully received",
  CANCELLED: "Cancelled",
};

export const QC_LABEL: Record<string, string> = {
  QUARANTINE: "Waiting for quality",
  APPROVED: "Released",
  REJECTED: "Rejected",
};

export const BATCH_LABEL: Record<string, string> = {
  PLANNED: "Planned",
  IN_PROCESS: "In process",
  CLOSED: "Finished",
};

export const INVOICE_LABEL: Record<string, string> = {
  OPEN: "Unpaid",
  PARTIAL: "Partly paid",
  PAID: "Paid",
};

export const CHANNEL_LABEL: Record<string, string> = {
  DIRECT: "Direct",
  DISTRIBUTOR: "Distributor",
  MUNICIPAL: "Municipal",
  AMAZON: "Amazon",
};

export const KIND_LABEL: Record<string, string> = {
  RAW: "Raw material",
  FINISHED: "Finished product",
  UTILITY: "Utility (not stored)",
};
