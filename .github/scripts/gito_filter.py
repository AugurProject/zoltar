from enum import IntEnum

class Confidence(IntEnum):
	HIGHEST = 1
	HIGH = 2
	MEDIUM = 3
	LOW = 4
	LOWEST = 5


class Severity(IntEnum):
	CRITICAL = 1
	MAJOR = 2
	MINOR = 3
	TRIVIAL = 4
	SUGGESTION = 5


def filter_issues(issues_by_file, max_confidence: Confidence, max_severity: Severity):
	"""Filters the issues dict in-place."""
	for file_path in issues_by_file:
		issues_by_file[file_path] = [
			issue for issue in issues_by_file[file_path]
			if issue["confidence"] <= max_confidence and issue["severity"] <= max_severity
		]
