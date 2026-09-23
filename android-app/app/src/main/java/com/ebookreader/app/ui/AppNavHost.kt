package com.ebookreader.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.ebookreader.app.EbookApp
import com.ebookreader.app.ui.library.LibraryScreen
import com.ebookreader.app.ui.library.LibraryViewModel
import com.ebookreader.app.ui.library.LibraryViewModelFactory
import com.ebookreader.app.ui.reader.ReaderScreen
import com.ebookreader.app.ui.settings.SettingsScreen

object Routes {
    const val LIBRARY = "library"
    const val SETTINGS = "settings"
    const val READER = "reader/{bookId}"
    fun reader(bookId: String) = "reader/$bookId"
}

@Composable
fun AppNavHost() {
    val context = LocalContext.current
    val app = context.applicationContext as EbookApp
    val settingsRepo = app.settingsRepo
    val repo = app.ebookRepo
    val downloadManager = app.downloadManager
    val navController = rememberNavController()

    NavHost(navController = navController, startDestination = Routes.LIBRARY) {
        composable(Routes.LIBRARY) {
            val vm: LibraryViewModel = viewModel(
                factory = LibraryViewModelFactory(repo, settingsRepo, downloadManager)
            )
            LibraryScreen(
                viewModel = vm,
                onOpenBook = { navController.navigate(Routes.reader(it)) },
                onOpenSettings = { navController.navigate(Routes.SETTINGS) }
            )
        }
        composable(Routes.SETTINGS) {
            SettingsScreen(
                settingsRepo = settingsRepo,
                repo = repo,
                downloadManager = downloadManager,
                onBack = { navController.popBackStack() }
            )
        }
        composable(
            route = Routes.READER,
            arguments = listOf(navArgument("bookId") { type = NavType.StringType })
        ) { entry ->
            val bookId = entry.arguments?.getString("bookId").orEmpty()
            ReaderScreen(
                bookId = bookId,
                repo = repo,
                settingsRepo = settingsRepo,
                downloadManager = downloadManager,
                onBack = { navController.popBackStack() }
            )
        }
    }
}
