# ---- שלב בנייה ----
# better-sqlite3 הוא מודול נייטיב וזקוק לכלי קומפילציה, שאין להם מה
# לחפש בתמונה שרצה בייצור. לכן בונים בשלב נפרד ומעתיקים רק את התוצר.
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- שלב הרצה ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./
COPY knowledge ./knowledge

# מסד הנתונים חייב לשבת על אחסון קבוע. בלי הגדרת volume, כל פריסה
# מחדש של הקונטיינר מוחקת את כל היסטוריית השיחות.
VOLUME ["/app/data"]
ENV DB_PATH=/app/data/bot.db

# לא רצים כ-root.
RUN chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
