require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('./db');

const fs = require('fs');

async function check() {
    try {
        const results = {};

        const tables = await query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);

        for (const table of tables.rows) {
            const res = await query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1 AND table_schema = 'public'
                ORDER BY ordinal_position
            `, [table.table_name]);
            results[table.table_name] = res.rows;
        }

        fs.writeFileSync('db-structure.json', JSON.stringify(results, null, 2));
        console.log('Results written to db-structure.json');
        process.exit(0);
    } catch (err) {
        fs.writeFileSync('db-error.txt', err.stack);
        process.exit(1);
    }
}

check();
