# AHS Signatures

A lightweight PDF signing system for internal acknowledgements. **Not intended for formal legal documents** - this system provides basic signature capture and tracking without a formal audit trail.

## Features

- **Template Management**: Upload PDF templates with placeholder tags for signatures
- **Signing Workflow**: Sequential signing with automatic routing to next signer
- **Signature Capture**: Draw signatures or type your name
- **Email Notifications**: Automated signing requests and completion notifications
- **Admin Dashboard**: Track signing progress and download completed documents
- **Basic Audit Log**: Track signing events (timestamps, IP addresses) for internal reference

## Tech Stack

- **Backend**: Node.js, Fastify, TypeScript, Prisma (SQLite)
- **Frontend**: Next.js, React, Tailwind CSS
- **PDF Processing**: pdf-lib
- **Signature Capture**: signature_pad
- **Email**: SendGrid or SMTP

## Quick Start

### Using Docker Compose

```bash
# Clone the repository
git clone <repo-url>
cd AHS-Signatures

# Start all services
docker-compose up -d

# Access the application
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:3001
# - MailHog (email viewer): http://localhost:8025
```

### Local Development

```bash
# Start MailHog for email testing
docker-compose -f docker-compose.dev.yml up -d

# Backend setup
cd backend
cp .env.example .env
npm install
npm run db:push
npm run db:seed  # Optional: seed demo data
npm run dev

# Frontend setup (new terminal)
cd frontend
cp .env.example .env
npm install
npm run dev

# Access the application
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:3001
# - MailHog: http://localhost:8025
```

## Template Placeholders

Add these tags to your PDF templates where signatures should appear:

| Tag | Description |
|-----|-------------|
| `[[SIGNATURE:roleName]]` | Signature field for the specified role |
| `[[DATE:roleName]]` | Date field (auto-filled when signing) |
| `[[TEXT:fieldName]]` | Text input field |

**Example roles**: employee, manager, contractor, witness

### Creating a Template PDF

1. Create a PDF document with your content
2. Add placeholder tags where signatures are needed:
   ```
   Employee Signature: [[SIGNATURE:employee]]
   Date: [[DATE:employee]]

   Manager Approval: [[SIGNATURE:manager]]
   Date: [[DATE:manager]]
   ```
3. Upload via the admin dashboard

## API Endpoints

### Templates

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/templates` | List all templates |
| GET | `/api/templates/:id` | Get template details |
| POST | `/api/templates` | Upload new template (multipart) |
| DELETE | `/api/templates/:id` | Delete template |

### Packets

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/packets` | List all packets |
| GET | `/api/packets/:id` | Get packet details |
| POST | `/api/packets` | Create new packet |
| POST | `/api/packets/:id/send` | Send packet for signing |
| POST | `/api/packets/:id/resend` | Resend signing link |
| POST | `/api/packets/:id/cancel` | Cancel packet |

### Signing

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/signing/:token` | Get signing session |
| POST | `/api/signing/:token/sign` | Submit signature |
| GET | `/api/signing/:token/pdf` | Preview PDF |

### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/stats` | Dashboard statistics |
| GET | `/api/admin/packets/:id/download` | Download signed PDF |
| GET | `/api/admin/audit-logs` | Query audit logs |

## Configuration

### Environment Variables

See `.env.example` for all available options.

**Required for production:**
- `DATABASE_URL`: SQLite database path
- `FRONTEND_URL`: Public URL for signing links
- `EMAIL_*`: Email provider configuration

### Email Providers

**SMTP (recommended for testing):**
```env
EMAIL_PROVIDER=smtp
SMTP_HOST=localhost
SMTP_PORT=1025
```

**SendGrid:**
```env
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=your-api-key
```

## Security Considerations

- Signing tokens are cryptographically random and expire after 72 hours (configurable)
- Resending a link invalidates the previous token
- IP addresses and user agents are logged for basic tracking
- Signatures are stored as base64 images in the database

## Limitations

This system is designed for **low-stakes internal acknowledgements only**:

- No formal legal audit trail
- No certificate-based signatures
- No tamper-evident sealing
- Not compliant with eIDAS, ESIGN, or similar regulations

For legally binding signatures, use established services like DocuSign, Adobe Sign, or similar.

## Project Structure

```
AHS-Signatures/
├── backend/
│   ├── src/
│   │   ├── routes/        # API route handlers
│   │   ├── services/      # Business logic (PDF, email)
│   │   ├── utils/         # Utilities (config, prisma, token)
│   │   └── index.ts       # Entry point
│   ├── prisma/
│   │   ├── schema.prisma  # Database schema
│   │   └── seed.ts        # Demo data seeder
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/         # Next.js pages
│   │   ├── components/    # React components
│   │   ├── lib/           # API client
│   │   └── styles/        # Global styles
│   └── package.json
├── docker-compose.yml     # Production setup
├── docker-compose.dev.yml # Development (MailHog only)
└── README.md
```

## License

MIT
