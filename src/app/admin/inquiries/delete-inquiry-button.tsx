"use client";

/**
 * Deletes one inquiry after a confirmation. Deleting cannot be undone, so the browser asks first.
 * The conversation behind the inquiry is kept.
 */
export function DeleteInquiryButton({
  action,
  tenantSlug,
  inquiryId
}: {
  action: (formData: FormData) => void | Promise<void>;
  tenantSlug: string;
  inquiryId: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm("Delete this inquiry? This cannot be undone. The conversation stays.")) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="inquiryId" value={inquiryId} />
      <button type="submit" className="adm-btn adm-btn--danger adm-btn--sm">
        Delete
      </button>
    </form>
  );
}
