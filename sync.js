const axios = require('axios');

const CONFIG_PATH = process.argv[2];
const CONFIG = require(CONFIG_PATH);

const FROM_DATE = process.argv[3];
const TO_DATE = process.argv[4];

const DRY_RUN = process.argv[5] != 'copy';

if (
    !CONFIG
    || !CONFIG.accounts
    || !CONFIG.accounts.src
    || !CONFIG.accounts.dst
    || !CONFIG.users
    || Object.keys(CONFIG.users).length === 0
    || !CONFIG.jobs
    || !Array.isArray(CONFIG.jobs)
    || CONFIG.jobs.length === 0
) {
    console.error(`Invalid configuration file: ${CONFIG_PATH}`);
    process.exit(1);
}

if (!FROM_DATE.match(/^\d{4}-\d{2}-\d{2}$/)) {
    console.error(`Invalid from date: ${FROM_DATE}`);
    process.exit(1);
}

if (!TO_DATE.match(/^\d{4}-\d{2}-\d{2}$/)) {
    console.error(`Invalid to date: ${TO_DATE}`);
    process.exit(1);
}

for (let i = 0; i < CONFIG.jobs.length; i++) {
    const job = CONFIG.jobs[i];

    if (!job.name) {
        console.error(`Invalid job #{i}: missing name`);
        process.exit(1);
    }

    if (!job.src) {
        console.error(`Invalid job #{i}: missing src`);
        process.exit(1);
    }

    if (!job.dst) {
        console.error(`Invalid job #{i}: missing dst`);
        process.exit(1);
    }
}


async function syncAllJobs() {
    for (const job of CONFIG.jobs) {
        syncAllUsers(job);
    }
}

async function syncAllUsers(job) {
    console.log(`Syncing job: ${job.name}`);

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

        const userHours = await syncAllEntries(job, srcHarvest, dstHarvest);
        console.log(`Total hours for ${user}: ${userHours}`);
        totalHours += userHours;
    }

    console.log(`Total hours for all users: ${totalHours}`);
}

async function syncAllEntries(job, srcHarvest, dstHarvest) {
    const srcClientRegex = job.src.client ? new RegExp(job.src.client) : null;
    const srcProjectRegex = job.src.project ? new RegExp(job.src.project) : null;
    const dstClientRegex = job.dst.client ? new RegExp(job.dst.client) : null;
    const dstProjectRegex = job.dst.project ? new RegExp(job.dst.project) : null;

    let totalHours = 0;

    try {
        // get source user
        const { data: srcMe } = await srcHarvest.get('/users/me');

        // find source project
        const { data: { project_assignments: srcAssignments } } = await srcHarvest.get('/users/me/project_assignments');
        const srcTargetAssignments = srcAssignments.filter(assignment => {
            if (srcClientRegex && !srcClientRegex.test(assignment.client.name)) {
                return false;
            }

            if (srcProjectRegex && !srcProjectRegex.test(assignment.project.name)) {
                return false;
            }

            return true;
        });

        if (srcTargetAssignments.length === 0) {
            console.error(`No matching source project found for user ${srcMe.email}`);
            return;
        }

        // find target project
        const { data: { project_assignments: dstAssignments } } = await dstHarvest.get('/users/me/project_assignments');
        const dstTargetAssignments = dstAssignments.filter(assignment => {
            if (dstClientRegex && !dstClientRegex.test(assignment.client.name)) {
                return false;
            }

            if (dstProjectRegex && !dstProjectRegex.test(assignment.project.name)) {
                return false;
            }

            return true;
        });

        if (dstTargetAssignments.length === 0) {
            console.error(`No matching destination project found for user ${srcMe.email}`);
            return 0;
        }

        if (dstTargetAssignments.length > 1) {
            console.error(`More than one matching destination project found for user ${srcMe.email}`);
            return 0;
        }

        for (const srcAssignment of srcTargetAssignments) {
            // get time entries for month
            const { data: { time_entries: srcEntries } } = await srcHarvest.get('/time_entries', {
                params: {
                    user_id: srcMe.id,
                    project_id: srcAssignment.project.id,
                    from: FROM_DATE,
                    to: TO_DATE
                }
            });

            // create time entry
            for (const srcEntry of srcEntries) {
                const dstEntry = {
                    project_id: dstTargetAssignments[0].project.id,
                    task_id: dstTargetAssignments[0].task_assignments[0].task.id,
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
        }
    } catch (err) {
        debugger;
    }

    return totalHours;
}


try {
    syncAllJobs();
} catch (err) {
    debugger;
}
