# Harvest sync

## Usage

```bash
# dry run to test configuration and preview hours that will be copies
node sync.js ./configs/example.json 2024-05-01 2024-05-31

# add `copy` parameter to actually execute if above looks good
node sync.js ./configs/example.json 2024-05-01 2024-05-31 copy
```

## Obtaining API Keys

Visit <https://id.getharvest.com/developers> to provision a Personal Access Token (**PAT**) and get the AccountID for any company you have access to. This will need to be done for each user you want to copy hours for. If users have access to both Harvest accounts you want to copy between with the same login, you only need one PAT.

## Configuration

Copy `configs/example.json` to your own config file:

- `accounts`: Configure `src` and `dst` "Account ID" for the two Harvest accounts you want to copy hours between. These can be easily found on the page for the PAT you created above
- `users`: A list of users that you want to sync hours for and the `src` and `dst` PAT. These can match if the same login can access both the source and destination Harvest account. Names for users can be whatever you want as long as they are unique keys for each user in the list.
- `jobs`: A list of jobs for copying entries to execute. Each entry can feature an arbitrary name to help identify it.
- `jobs[].src`: May include any combination of `client`, `project`, and `project_code` keys for matching *one or more* source projects. Each value is a RegExp
- `jobs[].dst`: May include any combination of `client`, `project`, and `project_code` keys for matching *exactly one* destination project. Each value is a RegExp
- `jobs[].tasks`: A mapping of source tasks to destination tasks. Keys and values are both RegExps. If any entries can't be matched to a destination task, an error will be thrown and the job will be stopped.
