import './globals.css';

export const metadata = {
  title: 'OmniAI — منصة ذكاء اصطناعي موحدة',
  description: 'محادثة ذكاء اصطناعي بمزودين متعددين، تدوير مفاتيح تلقائي، توليد صور، تفكير عميق، وإحصاء توكنات — واجهة عربية موحدة.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
