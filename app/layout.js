import './globals.css';
import Providers from './providers';

export const metadata = {
  title: 'CHIBANI AI — منصة ذكاء اصطناعي موحدة',
  description: 'محادثة ذكاء اصطناعي بمزودين متعددين، تدوير مفاتيح تلقائي، توليد صور، تفكير عميق، وإحصاء توكنات — واجهة عربية موحدة.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
