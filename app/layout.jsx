export const metadata = {
  title: 'Uttermost Overstocks Scraper',
  description: 'Logs into uttermost.com and pulls the latest overstock markdown prices.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
          background: '#0b0c0f',
          color: '#e8eaed',
        }}
      >
        {children}
      </body>
    </html>
  );
}
