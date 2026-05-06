#!/bin/bash

echo "🔄 Switching Prisma from SQLite to PostgreSQL..."

SCHEMA_FILE="prisma/schema.prisma"
ENV_FILE=".env"

# 1. Check if schema.prisma exists
if [ ! -f "$SCHEMA_FILE" ]; then
    echo "❌ Error: $SCHEMA_FILE not found!"
    exit 1
fi

# 2. Backup old schema
cp "$SCHEMA_FILE" "$SCHEMA_FILE.backup"
echo "✅ Backup created at $SCHEMA_FILE.backup"

# 3. Replace sqlite with postgresql using sed
# This changes 'provider = "sqlite"' to 'provider = "postgresql"'
sed -i '' 's/provider *= *"sqlite"/provider = "postgresql"/' "$SCHEMA_FILE"

# This changes 'url = "file:./dev.db"' to 'url = env("DATABASE_URL")'
sed -i '' 's/url *= *"file:\.\/dev\.db"/url = env("DATABASE_URL")/' "$SCHEMA_FILE"

echo "✅ Updated prisma/schema.prisma to use PostgreSQL!"

# 4. Create .env file if it doesn't exist
if [ ! -f "$ENV_FILE" ]; then
    echo "DATABASE_URL=\"postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public\"" > "$ENV_FILE"
    echo "✅ Created .env file. Please edit it and insert your actual PostgreSQL connection string!"
else
    echo "⚠️ .env file already exists. Ensure it contains the DATABASE_URL variable."
fi

echo ""
echo "🚀 Next steps:"
echo "1. Edit the .env file with your PostgreSQL URL."
echo "2. Run 'npx prisma generate' to rebuild the Prisma client."
echo "3. Run 'npx prisma db push' to create tables in your new PostgreSQL database."
echo "4. Run 'node seed.js' to migrate your initial data to the new DB."
