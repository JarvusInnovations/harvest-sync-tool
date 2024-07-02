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

        const userHours = await syncAllEntries(user, job, srcHarvest, dstHarvest);
        console.log(`Total hours for ${user}: ${userHours}`);
        totalHours += userHours;
    }

    console.log(`Total hours for all users: ${totalHours}`);
}

async function syncAllEntries(user, job, srcHarvest, dstHarvest) {
    // build client/project matching regexps
    const srcClientRegex = job.src.client ? new RegExp(job.src.client) : null;
    const srcProjectRegex = job.src.project ? new RegExp(job.src.project) : null;
    const srcProjectCodeRegex = job.src.project_code ? new RegExp(job.src.project_code) : null;
    const dstClientRegex = job.dst.client ? new RegExp(job.dst.client) : null;
    const dstProjectRegex = job.dst.project ? new RegExp(job.dst.project) : null;
    const dstProjectCodeRegex = job.dst.project_code ? new RegExp(job.dst.project_code) : null;

    // build task mapping regexps
    const taskRegexMap = new Map();
    for (const [srcTask, dstTask] of Object.entries(job.tasks)) {
        taskRegexMap.set(new RegExp(srcTask), new RegExp(dstTask));
    }

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

            if (srcProjectCodeRegex && !srcProjectCodeRegex.test(assignment.project.code)) {
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

            if (dstProjectCodeRegex && !dstProjectCodeRegex.test(assignment.project.code)) {
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

        const dstTargetAssignment = dstTargetAssignments[0];

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
                // find matching task
                let dstTaskId = null;
                for (const [srcTaskRegex, dstTaskRegex] of taskRegexMap.entries()) {
                    if (srcTaskRegex.test(srcEntry.task.name)) {
                        const dstTaskAssignment = dstTargetAssignment.task_assignments.find(assignment => dstTaskRegex.test(assignment.task.name));
                        if (dstTargetAssignment) {
                            dstTaskId = dstTaskAssignment.task.id;
                            break;
                        }
                    }
                }

                if (!dstTaskId) {
                    console.error(`No matching destination task found for source task ${srcEntry.task.name}`);
                    return totalHours;
                }

                // build destination entry
                const dstEntry = {
                    project_id: dstTargetAssignment.project.id,
                    task_id: dstTaskId,
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
        console.error(`Failed to sync entries for user ${user}: ${err.message}`);
    }

    return totalHours;
}


try {
    syncAllJobs();
} catch (err) {
    debugger;
}
