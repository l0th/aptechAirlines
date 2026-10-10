/** Cancellation is final independently of PayPal refund settlement. */
export function cancellationOutcomeMessages(result: {
  cancellation_number?: string;
  refund_amount?: number;
  refund_percentage?: number;
  refund_status?: string;
}): { vi: string; en: string } {
  const code = result.cancellation_number || '—';
  const amount = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })
    .format(result.refund_amount || 0);
  const percent = result.refund_percentage || 0;
  if (!(result.refund_amount! > 0)) {
    return {
      vi: `Đã hủy vé. Mã hủy: ${code}. Không phát sinh hoàn tiền theo chính sách.`,
      en: `Booking cancelled. Cancellation code: ${code}. No refund is due under the policy.`,
    };
  }
  const prefixVi = `Đã hủy vé. Mã hủy: ${code}. Số tiền dự kiến hoàn: ${amount} (${percent}%).`;
  const prefixEn = `Booking cancelled. Cancellation code: ${code}. Refund amount: ${amount} (${percent}%).`;
  switch (result.refund_status) {
    case 'SUCCESS':
      return { vi: `${prefixVi} PayPal đã xác nhận hoàn tiền.`, en: `${prefixEn} PayPal has confirmed the refund.` };
    case 'FAILED':
      return { vi: `${prefixVi} Hoàn tiền gặp lỗi, vui lòng liên hệ hỗ trợ.`, en: `${prefixEn} Refund needs assistance; please contact support.` };
    default:
      return { vi: `${prefixVi} Đang chờ PayPal xác nhận hoàn tiền.`, en: `${prefixEn} Awaiting PayPal refund confirmation.` };
  }
}
