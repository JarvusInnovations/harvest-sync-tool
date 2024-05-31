const axios = require('axios');

const DRY_RUN = true;

const FROM_DATE = '2024-04-01';
const TO_DATE = '2024-04-30';

const CONFIG_PATH = process.argv[2];
const CONFIG = require(CONFIG_PATH);

if (
    !CONFIG
    || !CONFIG.accounts
    || !CONFIG.accounts.src
    || !CONFIG.accounts.dst
    || !CONFIG.users
    || Object.keys(CONFIG.users).length === 0
) {
    console.error(`Invalid configuration file: ${CONFIG_PATH}`);
    process.exit(1);
}


async function syncAllUsers() {
    let totalHours = 0;

    for (const [user, tokens] of Object.entries(CONFIG.users)) {
        console.log(`Syncing user: ${user}`);

        const srcHarvest = axios.create({
            baseURL: 'https://api.harvestapp.com/api/v2',
            headers: {
                'Authorization': `Bearer ${tokens.src}`,
                'Harvest-Account-ID': CONFIG.accounts.src
            }
        });

        const dstHarvest = axios.create({
            baseURL: 'https://api.harvestapp.com/api/v2',
            headers: {
                'Authorization': `Bearer ${tokens.dst}`,
                'Harvest-Account-ID': CONFIG.accounts.dst
            }
        });

        const userHours = await sync(srcHarvest, dstHarvest);
        console.log(`Total hours for ${user}: ${userHours}`);
        totalHours += userHours;
    }

    console.log(`Total hours for all users: ${totalHours}`);
}

async function sync(srcHarvest, dstHarvest) {
    let totalHours = 0;

    try {
        // get source user
        const { data: srcMe } = await srcHarvest.get('/users/me');

        // find Xentrans project
        const { data: { project_assignments: srcAssignments } } = await srcHarvest.get('/users/me/project_assignments');
        const srcAssignment = srcAssignments.find(assignment => assignment.client.name == 'Xentrans');

        // get time entries for month
        const { data: { time_entries: srcEntries } } = await srcHarvest.get('/time_entries', {
            params: {
                user_id: srcMe.id,
                project_id: srcAssignment.project.id,
                from: FROM_DATE,
                to: TO_DATE
            }
        });

        // find CCJPA project
        const { data: { project_assignments: dstAssignments } } = await dstHarvest.get('/users/me/project_assignments');
        const dstAssignment = dstAssignments.find(assignment => assignment.project.name.startsWith('WT#012L'));

        // create time entry
        for (const srcEntry of srcEntries) {
            const dstEntry = {
                project_id: dstAssignment.project.id,
                task_id: dstAssignment.task_assignments[0].task.id,
                spent_date: srcEntry.spent_date,
                hours: srcEntry.hours,
                notes: srcEntry.notes
            };

            if (!DRY_RUN) {
                const response = await dstHarvest.post('/time_entries', dstEntry);
            }

            console.log(`Logged ${srcEntry.hours} hours on ${srcEntry.spent_date}`);
            totalHours += srcEntry.hours;
        }
    } catch (err) {
        debugger;
    }

    return totalHours;
}


try {
    syncAllUsers();
} catch (err) {
    debugger;
}
