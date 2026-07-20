export default function Modal({ title, onClose, children }) {
  return (
    <>
      <div className="absolute inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="absolute left-4 right-4 top-24 bottom-6 z-50 flex flex-col bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="닫기" className="w-8 h-8 flex items-center justify-center text-gray-500 text-2xl leading-none">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </>
  );
}
